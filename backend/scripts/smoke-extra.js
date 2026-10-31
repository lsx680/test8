'use strict';

/**
 * 扩展冒烟：覆盖第二轮业务链路
 * 刷新令牌轮换、RBAC 403、题目创建/版本/导入/删除保护、手动与随机组卷、
 * 试卷预览脱敏、题目分析/知识点/趋势、成绩申诉、公告/通知/参数、审计导出、备份触发
 *
 * 用法：先执行 scripts/smoke-test.js（产生一场已发布成绩的考试），再执行本脚本。
 */
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 3102;
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
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    json = { raw: text };
  }
  return { status: response.status, json, headers: response.headers };
}

function ok(result, label) {
  if (result.status >= 400 || !result.json || result.json.code !== 0) {
    throw new Error(`${label} 失败：HTTP ${result.status} ${JSON.stringify(result.json)}`);
  }
  return result.json.data;
}

function expectError(result, code, label) {
  if (result.json.code !== code) throw new Error(`${label} 期望错误码 ${code}，实际 ${result.json.code}（HTTP ${result.status}）`);
  return result.json;
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

  const teacher = ok(await request('POST', '/auth/login', { body: { username: 'T2024001', password: 'Teacher@2026' } }), '教师登录');
  const student = ok(await request('POST', '/auth/login', { body: { username: 'S2024001', password: 'Student@2026' } }), '学生登录');
  const admin = ok(await request('POST', '/auth/login', { body: { username: 'admin', password: 'Admin@2026' } }), '管理员登录');
  const t = teacher.accessToken;
  const s = student.accessToken;
  const a = admin.accessToken;
  console.log('[1] 三角色登录 PASS');

  // 刷新令牌轮换与重放检测
  const refreshed = ok(await request('POST', '/auth/refresh', { body: { refreshToken: student.refreshToken } }), '令牌刷新');
  assert.ok(refreshed.accessToken && refreshed.refreshToken, '刷新应返回新令牌对');
  const replay = await request('POST', '/auth/refresh', { body: { refreshToken: student.refreshToken } });
  expectError(replay, 10109, '旧刷新令牌重放');
  ok(await request('POST', '/auth/logout', { token: refreshed.accessToken, body: { refreshToken: refreshed.refreshToken } }), '登出');
  console.log('[2] 刷新轮换/重放检测/登出 PASS');

  // RBAC
  expectError(await request('POST', '/knowledge-points', { token: t, body: { kpName: '越权', level: 1 } }), 90301, '教师维护知识点');
  expectError(await request('GET', '/users', { token: t }), 90301, '教师查询用户列表');
  console.log('[3] RBAC 403 PASS');

  // 题目创建 / 版本 / 更新 / 导入 / 删除保护
  const createdQuestion = ok(await request('POST', '/questions', {
    token: t,
    body: {
      bankId: 1,
      knowledgePointId: 2,
      questionType: 'single',
      difficulty: 2,
      stem: '冒烟测试：以下哪个是 HTTP 状态码 201 的含义？',
      options: [{ key: 'A', content: '创建成功' }, { key: 'B', content: '请求错误' }],
      correctAnswer: ['A'],
      analysis: '201 Created',
      defaultScore: 5,
      status: 'published',
    },
  }), '新增题目');
  assert.strictEqual(createdQuestion.currentVersion, 1);
  const versions1 = ok(await request('GET', `/questions/${createdQuestion.id}/versions`, { token: t }), '题目版本');
  assert.strictEqual(versions1.length, 1);

  const updated = ok(await request('PUT', `/questions/${createdQuestion.id}`, {
    token: t,
    body: { stem: '冒烟测试（已修改）：HTTP 201 的含义？', correctAnswer: ['A'], version: 1 },
  }), '编辑题目');
  assert.strictEqual(updated.version, 2);
  const versions2 = ok(await request('GET', `/questions/${createdQuestion.id}/versions`, { token: t }), '题目版本2');
  assert.strictEqual(versions2.length, 2);

  const csv = [
    'questionType,stem,correctAnswer,defaultScore,difficulty',
    'judge,CSV 导入判断题：HTTP 是无状态协议。,true,5,2',
    'single,,["A"],5,3',
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'questions.csv');
  form.append('bankId', '1');
  const imported = ok(await request('POST', '/questions/import', { token: t, form }), '批量导入');
  assert.strictEqual(imported.successCount, 1);
  assert.strictEqual(imported.failureCount, 1);
  console.log('[4] 题目创建/版本/编辑/CSV导入 PASS:', JSON.stringify({
    questionId: createdQuestion.id, versions: versions2.length, import: imported,
  }));

  const referenced = await request('DELETE', '/questions/1', { token: t });
  expectError(referenced, 20106, '删除被引用题目');
  assert.ok(Array.isArray(referenced.json.data.papers) && referenced.json.data.papers.length > 0, '应返回引用清单');
  ok(await request('DELETE', `/questions/${createdQuestion.id}`, { token: t }), '删除未被引用题目');
  console.log('[5] 删除保护 PASS: 被引用题目返回 409 + 引用清单');

  // 手动组卷 / 预览 / 复制 / 调整
  const paper = ok(await request('POST', '/papers', {
    token: t,
    body: {
      paperName: `冒烟试卷 ${Date.now()}`,
      description: '扩展冒烟',
      totalScore: 15,
      durationMinutes: 45,
      questions: [{ questionId: 1, score: 5 }, { questionId: 2, score: 10 }],
    },
  }), '创建试卷');
  assert.strictEqual(paper.questionCount, 2);
  assert.strictEqual(paper.scoreCheck.matched, true);
  const preview = ok(await request('GET', `/papers/${paper.id}/preview`, { token: t }), '试卷预览');
  assert.deepStrictEqual(walkKeys(preview, ['correctAnswer', 'analysis', 'scoringPoints']), [], '预览不得含答案');
  const copied = ok(await request('POST', `/papers/${paper.id}/copy`, { token: t, body: { paperName: '冒烟试卷副本' } }), '复制试卷');
  assert.strictEqual(copied.questionCount, 2);
  const adjusted = ok(await request('PUT', `/papers/${paper.id}/questions`, {
    token: t,
    body: { questions: paper.questions.map((q, index) => ({ paperQuestionId: q.paperQuestionId, score: q.score, orderNo: index + 1, sectionNo: 1 })) },
  }), '调整试卷题目');
  assert.strictEqual(adjusted.questions.length, 2);
  console.log('[6] 手动组卷/预览脱敏/复制/调整 PASS:', JSON.stringify({
    paperId: paper.id, copiedId: copied.id, previewQuestions: preview.questions.length,
  }));

  // 随机组卷：成功 + 缺口
  const random = ok(await request('POST', '/papers/random', {
    token: t,
    body: {
      paperName: `随机卷 ${Date.now()}`,
      totalScore: 15,
      durationMinutes: 30,
      bankIds: [1],
      rules: [
        { questionType: 'single', count: 1, scorePerQuestion: 5 },
        { questionType: 'multiple', count: 1, scorePerQuestion: 10 },
      ],
    },
  }), '随机组卷');
  assert.strictEqual(random.questionCount, 2);
  assert.deepStrictEqual(random.shortages, []);
  const shortage = await request('POST', '/papers/random', {
    token: t,
    body: {
      paperName: '缺口卷',
      totalScore: 20,
      durationMinutes: 30,
      bankIds: [1],
      rules: [{ questionType: 'single', count: 20, scorePerQuestion: 1 }],
    },
  });
  const shortageBody = expectError(shortage, 30107, '随机组卷缺口');
  assert.ok(shortageBody.data.shortages.length > 0, '应返回缺口明细');
  console.log('[7] 随机组卷/缺口明细 PASS:', JSON.stringify({ randomId: random.paperId, shortage: shortageBody.data.shortages[0] }));

  // 统计：题目分析 / 知识点 / 趋势
  const exams = ok(await request('GET', '/exams?scoreStatus=published&page=1&pageSize=10', { token: t }), '已发布考试');
  assert.ok(exams.list.length > 0, '需先运行 smoke-test.js 生成已发布成绩考试');
  const examId = exams.list[0].id;
  const analysis = ok(await request('GET', `/exams/${examId}/question-analysis`, { token: t }), '题目质量分析');
  assert.ok(Array.isArray(analysis.questions) && analysis.questions.length === 5);
  const kpStats = ok(await request('GET', `/statistics/knowledge-points?examId=${examId}`, { token: t }), '知识点统计');
  assert.ok(Array.isArray(kpStats) && kpStats.length > 0);
  const trends = ok(await request('GET', `/statistics/trends?examIds=${examId}`, { token: t }), '趋势统计');
  assert.ok(trends.series.length > 0);
  console.log('[8] 题目分析/知识点/趋势 PASS:', JSON.stringify({
    examId, questionCount: analysis.questions.length, firstCorrectRate: analysis.questions[0].correctRate,
    kpCount: kpStats.length, series: trends.series.length,
  }));

  // 成绩申诉
  const attempts = ok(await request('GET', '/my/grades?page=1&pageSize=10', { token: s }), '我的成绩');
  const graded = attempts.list.find((item) => item.examId === examId);
  assert.ok(graded, '学生应有该场成绩');
  const appeal = ok(await request('POST', '/appeals', {
    token: s,
    body: { examId, questionId: 5, reason: '简答题第 4 个采分点应给分，请复核。' },
  }), '发起申诉');
  const teacherAppeals = ok(await request('GET', `/appeals?examId=${examId}&page=1&pageSize=10`, { token: t }), '教师申诉列表');
  assert.ok(teacherAppeals.list.some((item) => item.id === appeal.id));
  const handled = ok(await request('POST', `/appeals/${appeal.id}/handle`, {
    token: t,
    body: { status: 'accepted', comment: '复核后补 2 分', newScore: graded.totalScore + 2 },
  }), '处理申诉');
  assert.strictEqual(handled.status, 'accepted');
  const detail = ok(await request('GET', `/my/grades/${graded.attemptId}`, { token: s }), '申诉后成绩详情');
  assert.strictEqual(detail.totalScore, graded.totalScore + 2);
  console.log('[9] 成绩申诉与改分 PASS:', JSON.stringify({ appealId: appeal.id, old: graded.totalScore, new: detail.totalScore }));

  // 公告 / 通知 / 参数 / 审计导出 / 备份
  const notices = ok(await request('GET', '/notices?page=1&pageSize=10', { token: s }), '公告列表');
  assert.ok(notices.total >= 1, '种子公告应可见');
  const notice = ok(await request('POST', '/notices', {
    token: a,
    body: { title: '冒烟公告', content: '扩展冒烟测试公告', targetRole: 'all', status: 'published' },
  }), '发布公告');
  ok(await request('PUT', `/notices/${notice.id}`, {
    token: a,
    body: { title: '冒烟公告（已更新）', content: '更新内容', targetRole: 'all', status: 'published' },
  }), '编辑公告');
  ok(await request('DELETE', `/notices/${notice.id}`, { token: a }), '删除公告');

  const notifications = ok(await request('GET', '/notifications?page=1&pageSize=10', { token: s }), '站内通知');
  assert.ok(notifications.unreadCount >= 0);
  if (notifications.list.length > 0) {
    ok(await request('PATCH', `/notifications/${notifications.list[0].id}/read`, { token: s }), '通知已读');
  }

  const configs = ok(await request('GET', '/configs?group=exam', { token: a }), '参数列表');
  assert.ok(configs.length > 0);
  ok(await request('PUT', '/configs/exam.defaultDuration', { token: a, body: { configValue: '95', reason: '冒烟测试' } }), '修改参数');
  ok(await request('PUT', '/configs/exam.defaultDuration', { token: a, body: { configValue: '90', reason: '测试还原' } }), '还原参数');

  const auditCsv = await request('GET', '/audit-logs/export?module=exm', { token: a });
  assert.strictEqual(auditCsv.status, 200);
  assert.ok(String(auditCsv.headers.get('content-type')).includes('text/csv'));

  const backup = await request('POST', '/backups', { token: a });
  assert.strictEqual(backup.status, 202, `备份受理应为 202，实际 ${backup.status} ${JSON.stringify(backup.json)}`);
  const backups = ok(await request('GET', '/backups?page=1&pageSize=10', { token: a }), '备份记录');
  assert.ok(backups.total >= 1);
  console.log('[10] 公告/通知/参数/审计导出/备份 PASS:', JSON.stringify({
    notices: notices.total, unread: notifications.unreadCount, configs: configs.length,
    auditCsvStatus: auditCsv.status, backupId: backup.json.data.id, backupStatus: backup.json.data.status,
  }));

  console.log('\nEXTRA SMOKE TEST: ALL PASSED');
}

main()
  .catch((err) => {
    console.error(`\nEXTRA SMOKE TEST FAILED: ${err.message}`);
    if (serverLog) console.error(`server log:\n${serverLog}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  });