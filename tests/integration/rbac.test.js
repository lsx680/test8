'use strict';

/**
 * 集成测试：RBAC 功能权限 + 数据权限（REQ-UAM-08、REQ-NFR-05）
 * 覆盖：学生访问教师接口 403、教师访问他人数据 403、学生访问他人答卷 403、管理员全量可访问
 */
const { api, login, bearer, API } = require('../helpers/api');
const {
  loginSeed, createStudent, createTeacher, createSeedPaper, lockPaper,
  createActiveExam, publishExam, startAttempt, uniqueSuffix,
} = require('../helpers/fixtures');
const { closeBackendPool } = require('../helpers/db');

let admin;
let teacherA;
let teacherB;
let teacherBLogin;
let studentA;
let studentB;
let studentALogin;
let paper;
let exam;
let attempt;

beforeAll(async () => {
  admin = await loginSeed('admin');
  teacherA = await loginSeed('teacher');

  const suffix = uniqueSuffix();
  const teacherBAccount = await createTeacher(admin.accessToken, suffix);
  teacherBLogin = await login(teacherBAccount.username, teacherBAccount.password);

  studentA = await createStudent(admin.accessToken);
  studentB = await createStudent(admin.accessToken);
  studentALogin = await login(studentA.username, studentA.password);

  paper = await createSeedPaper(teacherA.accessToken, `RBAC 权限试卷-${suffix}`);
  await lockPaper(teacherA.accessToken, paper.id);
  exam = await createActiveExam(teacherA.accessToken, {
    paperId: paper.id,
    studentIds: [studentA.userId],
    examName: `RBAC 权限考试-${suffix}`,
  });
  await publishExam(teacherA.accessToken, exam.id);
  const started = await startAttempt(studentALogin.accessToken, exam.id);
  attempt = started.session;
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await closeBackendPool();
});

describe('学生访问教师专属接口 → 403', () => {
  test('TC-RBC-001 学生查询题库列表返回 403 / 90301', async () => {
    const res = await api().get(`${API}/question-banks`).set(bearer(studentALogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });

  test('TC-RBC-002 学生创建试卷返回 403 / 90301', async () => {
    const res = await api()
      .post(`${API}/papers`)
      .set(bearer(studentALogin.accessToken))
      .send({ paperName: '学生越权试卷', totalScore: 5, durationMinutes: 10, questions: [{ questionId: 1, score: 5 }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });

  test('TC-RBC-003 学生查询用户列表返回 403 / 90301', async () => {
    const res = await api().get(`${API}/users`).set(bearer(studentALogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });

  test('TC-RBC-004 学生查询考试成绩列表返回 403 / 90301', async () => {
    const res = await api().get(`${API}/exams/${exam.id}/scores`).set(bearer(studentALogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });

  test('TC-RBC-005 学生访问阅卷任务返回 403 / 90301', async () => {
    const res = await api().get(`${API}/grading-tasks`).set(bearer(studentALogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });

  test('TC-RBC-006 学生访问系统参数返回 403 / 90301', async () => {
    const res = await api().get(`${API}/configs`).set(bearer(studentALogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });
});

describe('教师访问他人数据 → 403（数据权限）', () => {
  test('TC-RBC-010 其他教师查询他人试卷返回 403 / 90302', async () => {
    const res = await api().get(`${API}/papers/${paper.id}`).set(bearer(teacherBLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90302);
  });

  test('TC-RBC-011 其他教师查询他人考试返回 403 / 90302', async () => {
    const res = await api().get(`${API}/exams/${exam.id}`).set(bearer(teacherBLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90302);
  });

  test('TC-RBC-012 其他教师查询他人题库内题目返回 403 / 30108', async () => {
    const res = await api().get(`${API}/questions/1`).set(bearer(teacherBLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(30108);
  });

  test('TC-RBC-013 其他教师修改他人题库返回 403 / 30108', async () => {
    const res = await api()
      .put(`${API}/question-banks/1`)
      .set(bearer(teacherBLogin.accessToken))
      .send({ bankName: '越权改名' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(30108);
  });

  test('TC-RBC-014 其他教师查询他人考试成绩返回 403 / 90302', async () => {
    const res = await api().get(`${API}/exams/${exam.id}/scores`).set(bearer(teacherBLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90302);
  });

  test('TC-RBC-015 其他教师查询他人考试统计返回 403 / 90302', async () => {
    const res = await api().get(`${API}/exams/${exam.id}/statistics`).set(bearer(teacherBLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90302);
  });

  test('TC-RBC-016 其他教师确认阅卷任务列表为空（数据权限过滤）', async () => {
    const res = await api()
      .get(`${API}/grading-tasks`)
      .query({ examId: exam.id })
      .set(bearer(teacherBLogin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.list).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  test('TC-RBC-017 教师仅能查看本人考试列表（数据权限过滤）', async () => {
    const res = await api()
      .get(`${API}/exams`)
      .query({ keyword: exam.examName })
      .set(bearer(teacherBLogin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.list.every((item) => item.ownerId === teacherBLogin.user.id)).toBe(true);
  });
});

describe('学生访问他人答卷 → 403', () => {
  test('TC-RBC-020 学生 B 读取学生 A 的答卷返回 403 / 40113', async () => {
    const studentBLogin = await login(studentB.username, studentB.password);
    const res = await api().get(`${API}/attempts/${attempt.attemptId}`).set(bearer(studentBLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40113);
  });

  test('TC-RBC-021 学生 B 读取学生 A 的题目列表返回 403 / 40113', async () => {
    const studentBLogin = await login(studentB.username, studentB.password);
    const res = await api()
      .get(`${API}/attempts/${attempt.attemptId}/questions`)
      .set(bearer(studentBLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40113);
  });
});

describe('管理员与资源所有者可正常访问', () => {
  test('TC-RBC-030 管理员可访问任意教师试卷与考试（超级权限）', async () => {
    const paperRes = await api().get(`${API}/papers/${paper.id}`).set(bearer(admin.accessToken));
    expect(paperRes.status).toBe(200);
    expect(paperRes.body.data.id).toBe(paper.id);

    const examRes = await api().get(`${API}/exams/${exam.id}`).set(bearer(admin.accessToken));
    expect(examRes.status).toBe(200);
    expect(examRes.body.data.id).toBe(exam.id);
  });

  test('TC-RBC-031 试卷所有者可访问本人试卷', async () => {
    const res = await api().get(`${API}/papers/${paper.id}`).set(bearer(teacherA.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ownerId).toBe(teacherA.user.id);
  });
});