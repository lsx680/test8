'use strict';

/**
 * 端到端冒烟测试（真实 HTTP + 真实 MySQL）
 * 覆盖：健康检查、三类账号登录、题库/题目查询、创建并发布考试、开考取题（脱敏断言）、
 *       答案暂存、交卷判分、人工阅卷、成绩发布、统计、审计日志
 *
 * 用法：node scripts/smoke-test.js
 * 前置：MySQL 已初始化（npm run db:init）
 */
const { spawn } = require('child_process');
const assert = require('assert');
const env = require('../src/config/env');

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: require('path').resolve(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'silent' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = { raw: text };
  }
  return { status: response.status, json };
}

function expectOk(result, label) {
  if (result.status >= 400 || !result.json || result.json.code !== 0) {
    throw new Error(`${label} 失败：HTTP ${result.status} ${JSON.stringify(result.json)}`);
  }
  return result.json.data;
}

function redactTokens(data) {
  if (!data) return data;
  const copy = { ...data };
  if (copy.accessToken) copy.accessToken = '***';
  if (copy.refreshToken) copy.refreshToken = '***';
  return copy;
}

function walkKeys(value, keys, found = []) {
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (keys.includes(key)) found.push(key);
      walkKeys(item, keys, found);
    }
  }
  return found;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await request('GET', '/health');
      if (result.status === 200) return;
    } catch (err) {
      // 等待监听
    }
    await sleep(500);
  }
  throw new Error(`服务启动超时。日志：\n${serverLog}`);
}

async function main() {
  await waitForServer();
  const output = {};

  const health = expectOk(await request('GET', '/health'), '健康检查');
  output.health = health;
  console.log('[1] health:', JSON.stringify(health));

  const adminLogin = expectOk(await request('POST', '/auth/login', {
    body: { username: 'admin', password: 'Admin@2026' },
  }), '管理员登录');
  const teacherLogin = expectOk(await request('POST', '/auth/login', {
    body: { username: 'T2024001', password: 'Teacher@2026' },
  }), '教师登录');
  const studentLogin = expectOk(await request('POST', '/auth/login', {
    body: { username: 'S2024001', password: 'Student@2026' },
  }), '学生登录');
  const adminToken = adminLogin.accessToken;
  const teacherToken = teacherLogin.accessToken;
  const studentToken = studentLogin.accessToken;
  output.logins = {
    admin: redactTokens(adminLogin),
    teacher: redactTokens(teacherLogin),
    student: redactTokens(studentLogin),
  };
  console.log('[2] login teacher:', JSON.stringify(redactTokens(teacherLogin)));
  console.log('[3] login student:', JSON.stringify(redactTokens(studentLogin)));

  const banks = expectOk(await request('GET', '/question-banks?page=1&pageSize=5', { token: teacherToken }), '题库列表');
  output.banks = banks;
  console.log('[4] question-banks:', JSON.stringify(banks));

  const questions = expectOk(await request('GET', '/questions?page=1&pageSize=5', { token: teacherToken }), '题目列表');
  output.questions = { total: questions.total, list: questions.list.map((q) => ({
    id: q.id, questionNo: q.questionNo, questionType: q.questionType, stem: q.stem, correctAnswer: q.correctAnswer,
  })) };
  console.log('[5] questions:', JSON.stringify(output.questions));

  const now = Date.now();
  const exam = expectOk(await request('POST', '/exams', {
    token: teacherToken,
    body: {
      examName: `冒烟考试 ${new Date().toISOString()}`,
      paperId: 1,
      startTime: new Date(now - 5 * 60000).toISOString(),
      endTime: new Date(now + 120 * 60000).toISOString(),
      durationMinutes: 90,
      passScore: 30,
      maxAttempts: 1,
      shuffleQuestions: false,
      antiCheatEnabled: true,
      antiCheatThreshold: 3,
      autoSubmitOnTimeout: true,
      description: '自动化冒烟测试考试',
      scope: { classIds: [1], studentIds: [3] },
    },
  }), '创建考试');
  output.exam = exam;
  console.log('[6] exam created:', JSON.stringify({ id: exam.id, status: exam.status, paperId: exam.paperId, scope: exam.scope }));

  const published = expectOk(await request('POST', `/exams/${exam.id}/publish`, { token: teacherToken }), '发布考试');
  output.published = published;
  console.log('[7] exam published:', JSON.stringify(published));

  const available = expectOk(await request('GET', '/exams/available?page=1&pageSize=20', { token: studentToken }), '可参加考试');
  output.available = available;
  const mine = available.list.find((item) => item.id === exam.id);
  assert.ok(mine, '学生可参加考试列表应包含新建考试');
  console.log('[8] available exam:', JSON.stringify({
    id: mine.id, canStart: mine.canStart, remainingAttempts: mine.remainingAttempts, status: mine.status,
  }));

  const started = await request('POST', `/exams/${exam.id}/attempts`, { token: studentToken, body: { deviceKey: 'smoke-device' } });
  if (![200, 201].includes(started.status)) throw new Error(`开考失败：HTTP ${started.status} ${JSON.stringify(started.json)}`);
  const session = started.json.data;
  assert.ok(session.attemptId, '开考应返回 attemptId');
  assert.ok(Array.isArray(session.questions) && session.questions.length === 5, '应下发 5 道题');
  const leaked = walkKeys(session.questions, ['correctAnswer', 'analysis', 'scoringPoints']);
  assert.deepStrictEqual(leaked, [], '取题响应不得包含答案/解析/采分点');
  output.attempt = {
    attemptId: session.attemptId,
    status: session.status,
    remainingSeconds: session.remainingSeconds,
    serverTime: session.serverTime,
    questionSample: session.questions[0],
    leakedKeys: leaked,
  };
  console.log('[9] attempt session (sanitized):', JSON.stringify(output.attempt));
  console.log('[10] sanitization assertion: PASS (no correctAnswer/analysis/scoringPoints)');

  const fetched = expectOk(await request('GET', `/attempts/${session.attemptId}/questions`, { token: studentToken }), '取题');
  assert.deepStrictEqual(walkKeys(fetched.questions, ['correctAnswer', 'analysis', 'scoringPoints']), [], '取题接口脱敏');
  console.log('[11] get questions sanitized: PASS');

  const remaining = expectOk(await request('GET', `/attempts/${session.attemptId}/remaining-time`, { token: studentToken }), '剩余时间');
  output.remaining = remaining;
  console.log('[12] remaining-time:', JSON.stringify(remaining));

  const byType = {};
  session.questions.forEach((question) => { byType[question.questionType] = question; });
  const answers = [
    { questionId: byType.single.questionId, answer: ['B'] },
    { questionId: byType.multiple.questionId, answer: ['A', 'B', 'D'] },
    { questionId: byType.judge.questionId, answer: ['true'] },
    { questionId: byType.fill.questionId, answer: [' syn+ack '] },
    { questionId: byType.short.questionId, answer: ['JWT 由 Header、Payload、Signature 三段组成，服务端重算签名校验完整性。'] },
  ];
  const saved = expectOk(await request('PUT', `/attempts/${session.attemptId}/answers`, { token: studentToken, body: { answers } }), '答案暂存');
  output.saved = saved;
  console.log('[13] save answers:', JSON.stringify(saved));

  const submitted = expectOk(await request('POST', `/attempts/${session.attemptId}/submit`, {
    token: studentToken,
    body: { submitType: 'manual' },
  }), '交卷');
  output.submitted = submitted;
  assert.strictEqual(submitted.replayed, false, '首次交卷 replayed 应为 false');
  assert.strictEqual(submitted.objectiveScore, 30, '客观题应得 30 分');
  assert.strictEqual(submitted.pendingManualCount, 1, '简答题应进入人工复核');
  console.log('[14] submit:', JSON.stringify(submitted));

  const replay = expectOk(await request('POST', `/attempts/${session.attemptId}/submit`, { token: studentToken, body: {} }), '重复交卷');
  assert.strictEqual(replay.replayed, true, '重复交卷应幂等重放');
  assert.strictEqual(replay.totalScore, submitted.totalScore, '重放总分一致');
  console.log('[15] idempotent replay:', JSON.stringify({ replayed: replay.replayed, totalScore: replay.totalScore, gradingTaskId: replay.gradingTaskId }));

  const tasks = expectOk(await request('GET', `/grading-tasks?examId=${exam.id}&page=1&pageSize=20`, { token: teacherToken }), '阅卷任务');
  assert.ok(tasks.total >= 1, '应生成简答题阅卷任务');
  const task = tasks.list[0];
  output.gradingTasks = tasks;
  console.log('[16] grading tasks:', JSON.stringify({ total: tasks.total, taskId: task.taskId, fullScore: task.fullScore, status: task.status }));

  const graded = expectOk(await request('POST', `/grading-tasks/${task.taskId}/score`, {
    token: teacherToken,
    body: { score: 15, comment: '要点基本完整' },
  }), '人工评分');
  output.graded = graded;
  assert.strictEqual(graded.totalScore, 45, '人工评分后总分应为 45');
  console.log('[17] manual score:', JSON.stringify(graded));

  const publishScores = expectOk(await request('POST', `/exams/${exam.id}/publish-scores`, { token: teacherToken }), '成绩发布');
  output.publishScores = publishScores;
  console.log('[18] publish scores:', JSON.stringify(publishScores));

  const myDetail = expectOk(await request('GET', `/my/grades/${session.attemptId}`, { token: studentToken }), '个人成绩详情');
  assert.strictEqual(myDetail.totalScore, 45);
  assert.ok(myDetail.questions[0].correctAnswer, '成绩发布后应可见标准答案');
  output.myDetail = {
    totalScore: myDetail.totalScore,
    isPassed: myDetail.isPassed,
    classRank: myDetail.classRank,
    questionCount: myDetail.questions.length,
    firstCorrectAnswer: myDetail.questions[0].correctAnswer,
  };
  console.log('[19] my grade detail:', JSON.stringify(output.myDetail));

  const statistics = expectOk(await request('GET', `/exams/${exam.id}/statistics`, { token: teacherToken }), '单场统计');
  output.statistics = statistics;
  console.log('[20] statistics:', JSON.stringify(statistics));

  const auditLogs = expectOk(await request('GET', '/audit-logs?page=1&pageSize=5&module=exm', { token: adminToken }), '审计日志');
  output.auditLogs = { total: auditLogs.total, sample: auditLogs.list[0] };
  console.log('[21] audit logs:', JSON.stringify(output.auditLogs));

  console.log('\nSMOKE TEST: ALL PASSED');
}

main()
  .catch((err) => {
    console.error(`\nSMOKE TEST FAILED: ${err.message}`);
    if (serverLog) console.error(`server log:\n${serverLog}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  });