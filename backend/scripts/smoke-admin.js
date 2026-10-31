'use strict';

/**
 * 管理端扩展冒烟：用户/注册审批/班级、知识点、试卷编辑与删除、题目导出、
 * 标准答案重判、防作弊事件、监控、补考授权、管理员判分重放、仲裁
 *
 * 用法：依次执行 smoke-test.js、smoke-extra.js 后运行本脚本。
 */
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 3103;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: require('path').resolve(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'silent' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch (err) {
    json = { raw: buffer.toString('utf8').slice(0, 200) };
  }
  return { status: response.status, json, buffer, headers: response.headers };
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
  const className = `冒烟班级${suffix}`;
  const klass = ok(await request('POST', '/classes', {
    token: a,
    body: { classCode: `SMOKE-${suffix}`, className, gradeYear: 2026, department: '计算机学院' },
  }), '新增班级');
  assert.ok(klass.id);

  const newUser = ok(await request('POST', '/users', {
    token: a,
    body: {
      username: `S${suffix}`,
      realName: '冒烟学生',
      roleCode: 'student',
      classId: klass.id,
      email: `smoke${suffix}@oes.edu.cn`,
    },
  }), '创建用户');
  assert.ok(newUser.initialPassword && newUser.user.id);
  ok(await request('PATCH', `/users/${newUser.user.id}/status`, {
    token: a,
    body: { status: 'disabled', reason: '冒烟测试禁用' },
  }), '禁用账号');
  ok(await request('PATCH', `/users/${newUser.user.id}/status`, {
    token: a,
    body: { status: 'active', reason: '冒烟测试启用' },
  }), '启用账号');
  ok(await request('PATCH', `/users/${newUser.user.id}/role`, {
    token: a,
    body: { roleCode: 'teacher' },
  }), '调整角色');
  const reset = ok(await request('POST', `/users/${newUser.user.id}/reset-password`, { token: a }), '重置密码');
  assert.ok(reset.temporaryPassword);

  // 学生自主注册 → 管理员审批
  const registerSuffix = String(Date.now()).slice(-5);
  const registered = ok(await request('POST', '/auth/register', {
    body: {
      username: `SREG${registerSuffix}`,
      realName: '待审核学生',
      password: 'Student@2026',
      classId: klass.id,
      email: `sreg${registerSuffix}@oes.edu.cn`,
    },
  }), '学生注册');
  assert.strictEqual(registered.status, 'pending');
  const pending = ok(await request('GET', '/users/pending?page=1&pageSize=10', { token: a }), '待审核列表');
  assert.ok(pending.list.some((item) => item.id === registered.userId));
  ok(await request('POST', `/users/${registered.userId}/approve`, { token: a }), '审批通过');
  ok(await request('POST', '/auth/login', {
    body: { username: `SREG${registerSuffix}`, password: 'Student@2026' },
  }), '审批后登录');
  console.log('[1] 班级/用户/角色/重置密码/注册审批 PASS:', JSON.stringify({
    classId: klass.id, userId: newUser.user.id, approvedUserId: registered.userId,
  }));

  // 知识点
  const kp = ok(await request('POST', '/knowledge-points', {
    token: a,
    body: { kpCode: `KP-SMOKE-${suffix}`, kpName: `冒烟知识点${suffix}`, level: 1, sortOrder: 99 },
  }), '新增知识点');
  ok(await request('PUT', `/knowledge-points/${kp.id}`, {
    token: a,
    body: { kpCode: kp.kpCode, kpName: `冒烟知识点${suffix}（改）`, level: 1, sortOrder: 98 },
  }), '编辑知识点');
  ok(await request('PATCH', `/knowledge-points/${kp.id}/status`, { token: a, body: { status: 'archived' } }), '归档知识点');
  const tree = ok(await request('GET', '/knowledge-points?includeArchived=true', { token: t }), '知识点树');
  assert.ok(JSON.stringify(tree).includes(kp.kpCode));
  console.log('[2] 知识点新增/编辑/归档 PASS:', JSON.stringify({ kpId: kp.id }));

  // 试卷编辑与删除（副本来自 smoke-extra）
  const papers = ok(await request('GET', '/papers?keyword=冒烟试卷副本&page=1&pageSize=10', { token: t }), '试卷列表');
  if (papers.list.length > 0) {
    const target = papers.list[0];
    ok(await request('PUT', `/papers/${target.id}`, {
      token: t,
      body: { paperName: `${target.paperName}（改）`, description: '管理端冒烟' },
    }), '编辑试卷');
    ok(await request('DELETE', `/papers/${target.id}`, { token: t }), '删除试卷');
  }

  // 题目导出
  const exported = await request('GET', '/questions/export?bankId=1', { token: t });
  assert.strictEqual(exported.status, 200);
  assert.ok(exported.buffer.length > 1000, '导出的 xlsx 应有内容');
  assert.ok(String(exported.headers.get('content-type')).includes('spreadsheetml'));
  console.log('[3] 试卷编辑/删除、题目导出 xlsx PASS:', JSON.stringify({
    deletedPaper: papers.list.length > 0, xlsxBytes: exported.buffer.length,
  }));

  // 标准答案重判：Q1 B → A → B
  const rejudge1 = ok(await request('POST', '/questions/1/rejudge', {
    token: a,
    body: { correctAnswer: ['A'], reason: '冒烟测试：临时改答案', scope: 'exam', examId: 2 },
  }), '重判1');
  assert.ok(rejudge1.affectedAttempts >= 1);
  const rejudge2 = ok(await request('POST', '/questions/1/rejudge', {
    token: a,
    body: { correctAnswer: ['B'], reason: '冒烟测试：还原答案', scope: 'exam', examId: 2 },
  }), '重判2');
  assert.ok(rejudge2.changeLogIds.length >= 1);
  console.log('[4] 标准答案重判/留痕 PASS:', JSON.stringify({
    affected: rejudge1.affectedAttempts, changed: rejudge1.scoreChangedAttempts, logs: rejudge2.changeLogIds.length,
  }));

  // 新考试：防作弊 / 监控 / 补考授权 / 管理员判分重放 / 仲裁
  const now = Date.now();
  const exam = ok(await request('POST', '/exams', {
    token: t,
    body: {
      examName: `管理端冒烟考试 ${suffix}`,
      paperId: 1,
      startTime: new Date(now - 60000).toISOString(),
      endTime: new Date(now + 2 * 3600000).toISOString(),
      durationMinutes: 90,
      passScore: 30,
      maxAttempts: 1,
      shuffleQuestions: true,
      antiCheatEnabled: true,
      antiCheatThreshold: 3,
      autoSubmitOnTimeout: true,
      scope: { classIds: [1] },
    },
  }), '创建考试');
  ok(await request('POST', `/exams/${exam.id}/publish`, { token: t }), '发布考试');
  const started = ok(await request('POST', `/exams/${exam.id}/attempts`, { token: s, body: { deviceKey: 'smoke-admin' } }), '开考');
  let lastEvent;
  for (let i = 0; i < 3; i += 1) {
    lastEvent = ok(await request('POST', `/attempts/${started.attemptId}/cheat-events`, {
      token: s,
      body: { eventType: 'switch_screen', detail: { visibility: 'hidden', seq: i + 1 } },
    }), `防作弊事件${i + 1}`);
  }
  assert.strictEqual(lastEvent.cumulativeCount, 3);
  assert.strictEqual(lastEvent.isAbnormal, true);

  const monitor = ok(await request('GET', `/exams/${exam.id}/monitor`, { token: t }), '考试监控');
  assert.ok(monitor.abnormalCount >= 1 && monitor.doingCount >= 1);
  const events = ok(await request('GET', `/exams/${exam.id}/anti-cheat-events?page=1&pageSize=10`, { token: t }), '防作弊事件列表');
  assert.ok(events.total >= 3);

  ok(await request('POST', `/exams/${exam.id}/grants`, {
    token: t,
    body: { studentIds: [3], extraAttempts: 1, reason: '冒烟测试补考授权' },
  }), '补考授权');
  const tasks = ok(await request('GET', `/exams/${exam.id}/tasks?page=1&pageSize=10`, { token: t }), '考试任务');
  assert.strictEqual(tasks.list[0].attemptsAllowed, 2);

  const submitted = ok(await request('POST', `/attempts/${started.attemptId}/submit`, {
    token: s,
    body: { submitType: 'manual' },
  }), '交卷');
  const regraded = ok(await request('POST', `/attempts/${started.attemptId}/grade`, { token: a }), '管理员判分重放');
  assert.strictEqual(regraded.totalScore, submitted.totalScore, '重放结果一致');

  const gradingTasks = ok(await request('GET', `/grading-tasks?examId=${exam.id}&page=1&pageSize=10`, { token: t }), '阅卷任务');
  const task = gradingTasks.list[0];
  assert.ok(task);
  const arbitrated = ok(await request('POST', `/grading-tasks/${task.taskId}/arbitrate`, {
    token: a,
    body: { score: 18, reason: '管理员直接裁定（冒烟）' },
  }), '仲裁');
  assert.strictEqual(arbitrated.finalScore, 18);
  ok(await request('POST', `/exams/${exam.id}/publish-scores`, { token: t }), '发布成绩');
  console.log('[5] 防作弊/监控/补考/判分重放/仲裁 PASS:', JSON.stringify({
    examId: exam.id, cheatCount: lastEvent.cumulativeCount, abnormal: monitor.abnormalCount,
    attemptsAllowed: tasks.list[0].attemptsAllowed, arbitratedScore: arbitrated.finalScore,
  }));

  console.log('\nADMIN SMOKE TEST: ALL PASSED');
}

main()
  .catch((err) => {
    console.error(`\nADMIN SMOKE TEST FAILED: ${err.message}`);
    if (serverLog) console.error(`server log:\n${serverLog}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  });