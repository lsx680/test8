'use strict';

/**
 * 5 个缺陷的回归验证脚本（真实 HTTP + 真实 MySQL）
 * 用法：node scripts/regress-bugs.js
 * 覆盖：BUG-4 驳回注册、BUG-1 CSV 空答案、BUG-2 重放判分进度、
 *       BUG-3 examId 类型、BUG-5 参数范围校验
 */
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 3104;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: require('path').resolve(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'silent', RATE_LIMIT_MAX: '1000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
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

function ok(result, label) {
  if (result.status >= 400 || !result.json || result.json.code !== 0) {
    throw new Error(`${label} 失败：HTTP ${result.status} ${JSON.stringify(result.json)}`);
  }
  return result.json.data;
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const result = await request('GET', '/health');
      if (result.status === 200) return;
    } catch (err) { /* 等待 */ }
    await sleep(500);
  }
  throw new Error(`服务启动超时：\n${serverLog}`);
}

async function main() {
  await waitForServer();
  const admin = ok(await request('POST', '/auth/login', { body: { username: 'admin', password: 'Admin@2026' } }), '管理员登录');
  const teacher = ok(await request('POST', '/auth/login', { body: { username: 'T2024001', password: 'Teacher@2026' } }), '教师登录');
  const student = ok(await request('POST', '/auth/login', { body: { username: 'S2024001', password: 'Student@2026' } }), '学生登录');
  const a = admin.accessToken;
  const t = teacher.accessToken;
  const s = student.accessToken;
  const suffix = String(Date.now()).slice(-6);

  /* -------------------- BUG-4：驳回注册申请不得 500 -------------------- */
  const registered = ok(await request('POST', '/auth/register', {
    body: {
      username: `SREJ${suffix}`,
      realName: '回归驳回学生',
      password: 'Student@2026',
      classId: 1,
      email: `srej${suffix}@oes.edu.cn`,
    },
  }), '注册待审核用户');
  const reject = await request('POST', `/users/${registered.userId}/reject`, {
    token: a,
    body: { reason: '回归测试：驳回该注册申请' },
  });
  assert.strictEqual(reject.status, 200, `驳回应返回 200，实际 ${reject.status} ${JSON.stringify(reject.json)}`);
  const rejectedUser = ok(await request('GET', `/users/${registered.userId}`, { token: a }), '查询被驳回用户');
  assert.strictEqual(rejectedUser.status, 'disabled');
  const rejectedLogin = await request('POST', '/auth/login', {
    body: { username: `SREJ${suffix}`, password: 'Student@2026' },
  });
  assert.strictEqual(rejectedLogin.status, 403);
  assert.strictEqual(rejectedLogin.json.code, 10103);
  console.log('[BUG-4] PASS', JSON.stringify({
    rejectStatus: reject.status,
    userStatus: rejectedUser.status,
    loginStatus: rejectedLogin.status,
    loginCode: rejectedLogin.json.code,
  }));

  /* -------------------- BUG-1：CSV 空答案不得导入 "undefined" -------------------- */
  const csv = [
    'questionType,stem,correctAnswer,defaultScore,difficulty',
    'judge,回归测试判断题：HTTP 是无状态协议。,true,5,2',
    'fill,回归测试填空题：TCP 与 UDP 的协议名（分号分隔）。,TCP;UDP,10,3',
    'fill,回归测试空答案填空题：该行答案为空。,,10,3',
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'regress-empty-answer.csv');
  form.append('bankId', '1');
  const imported = ok(await request('POST', '/questions/import', { token: t, form }), 'CSV 导入');
  assert.strictEqual(imported.totalRows, 3);
  assert.strictEqual(imported.successCount, 2, '2 行合法数据应成功');
  assert.strictEqual(imported.failureCount, 1, '空答案行应失败');
  assert.strictEqual(imported.failures.length, 1);
  assert.ok(/答案不能为空/.test(imported.failures[0].reason), `失败原因应明确，实际：${imported.failures[0].reason}`);
  const importedBank = ok(await request('GET', '/questions?bankId=1&keyword=回归测试&page=1&pageSize=20', { token: t }), '查询导入题目');
  assert.ok(!importedBank.list.some((q) => JSON.stringify(q.correctAnswer).includes('undefined')), '不得出现 undefined 答案');
  console.log('[BUG-1] PASS', JSON.stringify({
    totalRows: imported.totalRows,
    successCount: imported.successCount,
    failureCount: imported.failureCount,
    failure: imported.failures[0],
  }));

  /* -------------------- 准备一场考试，用于 BUG-2 / BUG-3 -------------------- */
  const now = Date.now();
  const exam = ok(await request('POST', '/exams', {
    token: t,
    body: {
      examName: `缺陷回归考试 ${suffix}`,
      paperId: 1,
      startTime: new Date(now - 60000).toISOString(),
      endTime: new Date(now + 2 * 3600000).toISOString(),
      durationMinutes: 90,
      passScore: 30,
      maxAttempts: 1,
      shuffleQuestions: false,
      antiCheatEnabled: true,
      antiCheatThreshold: 3,
      autoSubmitOnTimeout: true,
      scope: { classIds: [1] },
    },
  }), '创建考试');
  const published = ok(await request('POST', `/exams/${exam.id}/publish`, { token: t }), '发布考试');
  assert.strictEqual(typeof published.examId, 'number', 'publishExam.examId 应为 number');
  const started = ok(await request('POST', `/exams/${exam.id}/attempts`, { token: s, body: {} }), '开考');
  const byType = {};
  started.questions.forEach((question) => { byType[question.questionType] = question; });
  ok(await request('PUT', `/attempts/${started.attemptId}/answers`, {
    token: s,
    body: {
      answers: [
        { questionId: byType.single.questionId, answer: ['B'] },
        { questionId: byType.multiple.questionId, answer: ['A', 'B', 'D'] },
        { questionId: byType.judge.questionId, answer: ['true'] },
        { questionId: byType.fill.questionId, answer: ['SYN+ACK'] },
        { questionId: byType.short.questionId, answer: ['JWT 由 Header、Payload、Signature 三部分组成。'] },
      ],
    },
  }), '答案暂存');
  const submitted = ok(await request('POST', `/attempts/${started.attemptId}/submit`, {
    token: s,
    body: { submitType: 'manual' },
  }), '交卷');
  assert.strictEqual(submitted.objectiveScore, 30);

  const gradingTasks = ok(await request('GET', `/grading-tasks?examId=${exam.id}&page=1&pageSize=10`, { token: t }), '阅卷任务');
  const task = gradingTasks.list[0];
  assert.ok(task, '应存在简答题阅卷任务');
  ok(await request('POST', `/grading-tasks/${task.taskId}/score`, {
    token: t,
    body: { score: 15, comment: '回归评分' },
  }), '人工评分');

  const progressBefore = ok(await request('GET', `/exams/${exam.id}/grading-progress`, { token: t }), '阅卷进度（重放前）');
  assert.ok(progressBefore.completionRate > 0, '人工评分完成后进度应为 100%');
  assert.ok(progressBefore.gradedAttempts >= 1);

  /* -------------------- BUG-2：判分重放不得回退进度 -------------------- */
  const replayed = ok(await request('POST', `/attempts/${started.attemptId}/grade`, { token: a }), '管理员判分重放');
  assert.strictEqual(replayed.gradingStatus, 'done', '重放后 gradingStatus 应保持 done');
  const progressAfter = ok(await request('GET', `/exams/${exam.id}/grading-progress`, { token: t }), '阅卷进度（重放后）');
  assert.strictEqual(progressAfter.completionRate, progressBefore.completionRate);
  assert.ok(progressAfter.gradedAttempts >= 1, '重放后已阅答卷数不能归零');
  assert.ok(progressAfter.completionRate > 0, '重放后完成率不能为 0');
  console.log('[BUG-2] PASS', JSON.stringify({
    beforeReplay: progressBefore.completionRate,
    afterReplay: progressAfter.completionRate,
    gradedAttempts: progressAfter.gradedAttempts,
    gradingStatus: replayed.gradingStatus,
  }));

  /* -------------------- BUG-3：examId 必须为 number -------------------- */
  const publishedScores = ok(await request('POST', `/exams/${exam.id}/publish-scores`, { token: t }), '发布成绩');
  const monitor = ok(await request('GET', `/exams/${exam.id}/monitor`, { token: t }), '监控看板');
  const progress = ok(await request('GET', `/exams/${exam.id}/grading-progress`, { token: t }), '阅卷进度');
  assert.strictEqual(typeof publishedScores.examId, 'number');
  assert.strictEqual(typeof monitor.examId, 'number');
  assert.strictEqual(typeof progress.examId, 'number');
  console.log('[BUG-3] PASS', JSON.stringify({
    publishScores: typeof publishedScores.examId,
    monitor: typeof monitor.examId,
    gradingProgress: typeof progress.examId,
    values: [publishedScores.examId, monitor.examId, progress.examId],
  }));

  /* -------------------- BUG-5：参数业务范围校验 -------------------- */
  const invalidConfig = await request('PUT', '/configs/security.maxLoginFail', {
    token: a,
    body: { configValue: '9999', reason: '回归测试：非法范围' },
  });
  assert.strictEqual(invalidConfig.status, 400, `非法参数应返回 400，实际 ${invalidConfig.status}`);
  assert.strictEqual(invalidConfig.json.code, 70102);
  assert.ok(/取值范围/.test(invalidConfig.json.message));
  const restored = ok(await request('PUT', '/configs/security.maxLoginFail', {
    token: a,
    body: { configValue: '5', reason: '回归测试：还原默认值' },
  }), '还原参数');
  assert.strictEqual(restored.configValue, '5');
  console.log('[BUG-5] PASS', JSON.stringify({
    status: invalidConfig.status,
    code: invalidConfig.json.code,
    message: invalidConfig.json.message,
    restoredValue: restored.configValue,
  }));

  console.log('\nBUG REGRESSION: ALL 5 PASSED');
}

main()
  .catch((err) => {
    console.error(`\nBUG REGRESSION FAILED: ${err.message}`);
    if (serverLog) console.error(`server log:\n${serverLog}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  });