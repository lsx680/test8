'use strict';

/**
 * 集成测试数据工厂：所有数据均通过真实 HTTP 接口创建，保证测试的是完整链路。
 * 每个测试文件使用 uniqueSuffix() 生成唯一标识，避免文件之间互相干扰。
 */
const { api, login, bearer, API } = require('./api');

const SEED = Object.freeze({
  admin: { username: 'admin', password: 'Admin@2026', roleCode: 'admin' },
  teacher: { username: 'T2024001', password: 'Teacher@2026', roleCode: 'teacher' },
  student: { username: 'S2024001', password: 'Student@2026', roleCode: 'student' },
});

/** 种子题目：1 单选 5 分 / 2 多选 10 分 / 3 判断 5 分 / 4 填空 10 分 / 5 简答 20 分 */
const SEED_PAPER_ITEMS = Object.freeze([
  { questionId: 1, score: 5, sectionNo: 1 },
  { questionId: 2, score: 10, sectionNo: 1 },
  { questionId: 3, score: 5, sectionNo: 1 },
  { questionId: 4, score: 10, sectionNo: 2 },
  { questionId: 5, score: 20, sectionNo: 3 },
]);
const SEED_PAPER_TOTAL_COVERAGE = SEED_PAPER_ITEMS.reduce((sum, item) => sum + item.score, 0);

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function loginSeed(role) {
  const seed = SEED[role];
  return login(seed.username, seed.password);
}

/** 管理员创建 active 学生，返回 { userId, username, password, classId } */
async function createStudent(adminToken, suffix = uniqueSuffix(), { classId = 1 } = {}) {
  const username = `S${suffix}`.slice(0, 32);
  const response = await api()
    .post(`${API}/users`)
    .set(bearer(adminToken))
    .send({
      username,
      realName: `测试学生${suffix.slice(-4)}`,
      roleCode: 'student',
      email: `stu-${suffix}@oes.test`,
      classId,
    });
  if (response.status !== 201 || response.body.code !== 0) {
    throw new Error(`创建学生失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return {
    userId: response.body.data.user.id,
    username,
    password: response.body.data.initialPassword,
    classId,
    realName: response.body.data.user.realName,
  };
}

/** 管理员创建 active 教师，返回 { userId, username, password } */
async function createTeacher(adminToken, suffix = uniqueSuffix()) {
  const username = `T${suffix}`.slice(0, 32);
  const response = await api()
    .post(`${API}/users`)
    .set(bearer(adminToken))
    .send({
      username,
      realName: `测试教师${suffix.slice(-4)}`,
      roleCode: 'teacher',
      email: `teacher-${suffix}@oes.test`,
      department: '计算机学院',
    });
  if (response.status !== 201 || response.body.code !== 0) {
    throw new Error(`创建教师失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return {
    userId: response.body.data.user.id,
    username,
    password: response.body.data.initialPassword,
  };
}

/** 创建题库，返回 bank 对象 */
async function createBank(token, bankName) {
  const response = await api()
    .post(`${API}/question-banks`)
    .set(bearer(token))
    .send({ bankName, description: '集成测试题库' });
  if (response.status !== 201 || response.body.code !== 0) {
    throw new Error(`创建题库失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/** 创建题目，返回 question 对象 */
async function createQuestion(token, payload) {
  const response = await api()
    .post(`${API}/questions`)
    .set(bearer(token))
    .send(payload);
  if (response.status !== 201 || response.body.code !== 0) {
    throw new Error(`创建题目失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/** 用种子题目 1~5 手动组卷（总分 50） */
async function createSeedPaper(token, paperName, { totalScore = SEED_PAPER_TOTAL_COVERAGE } = {}) {
  const response = await api()
    .post(`${API}/papers`)
    .set(bearer(token))
    .send({
      paperName,
      description: '集成测试试卷',
      totalScore,
      durationMinutes: 30,
      questions: SEED_PAPER_ITEMS,
    });
  if (response.status !== 201 || response.body.code !== 0) {
    throw new Error(`创建试卷失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/** 锁定试卷（发布考试的前置条件） */
async function lockPaper(token, paperId) {
  const response = await api()
    .patch(`${API}/papers/${paperId}/status`)
    .set(bearer(token))
    .send({ status: 'locked' });
  if (response.status !== 200 || response.body.code !== 0) {
    throw new Error(`锁定试卷失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
}

/** 创建时间窗覆盖当前时刻的考试（默认已开始 10 分钟、剩余 50 分钟） */
async function createActiveExam(token, {
  paperId,
  studentIds = [],
  classIds = [],
  examName = `集成测试考试-${uniqueSuffix()}`,
  durationMinutes = 30,
  passScore = 30,
} = {}) {
  const startTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const endTime = new Date(Date.now() + 50 * 60 * 1000).toISOString();
  const response = await api()
    .post(`${API}/exams`)
    .set(bearer(token))
    .send({
      examName,
      paperId,
      startTime,
      endTime,
      durationMinutes,
      passScore,
      maxAttempts: 1,
      shuffleQuestions: false,
      antiCheatEnabled: true,
      antiCheatThreshold: 3,
      autoSubmitOnTimeout: true,
      scope: { studentIds, classIds },
    });
  if (response.status !== 201 || response.body.code !== 0) {
    throw new Error(`创建考试失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

async function publishExam(token, examId) {
  const response = await api()
    .post(`${API}/exams/${examId}/publish`)
    .set(bearer(token))
    .send({});
  if (response.status !== 200 || response.body.code !== 0) {
    throw new Error(`发布考试失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

async function startAttempt(token, examId) {
  const response = await api()
    .post(`${API}/exams/${examId}/attempts`)
    .set(bearer(token))
    .send({});
  if (![200, 201].includes(response.status) || response.body.code !== 0) {
    throw new Error(`开考失败：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return { status: response.status, session: response.body.data };
}

module.exports = {
  SEED,
  SEED_PAPER_ITEMS,
  SEED_PAPER_TOTAL_COVERAGE,
  uniqueSuffix,
  loginSeed,
  createStudent,
  createTeacher,
  createBank,
  createQuestion,
  createSeedPaper,
  lockPaper,
  createActiveExam,
  publishExam,
  startAttempt,
};