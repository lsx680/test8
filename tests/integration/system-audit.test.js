'use strict';

/**
 * 集成测试：系统管理与审计（REQ-SYS-01~06）、用户与权限管理（REQ-UAM-05/08/09）、
 *            跨场次统计与导出（REQ-STA-04~06）
 */
const { api, login, bearer, API } = require('../helpers/api');
const {
  loginSeed, createStudent, createActiveExam, publishExam, uniqueSuffix, SEED,
} = require('../helpers/fixtures');
const { closeBackendPool } = require('../helpers/db');

let admin;
let teacher;
let student;
let exam;

function parseBinary(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

beforeAll(async () => {
  admin = await loginSeed('admin');
  teacher = await loginSeed('teacher');
  student = await loginSeed('student');

  // 使用种子试卷（id=1，teacher 所有，已锁定）创建并发布考试，用于产生通知与审计
  exam = await createActiveExam(teacher.accessToken, {
    paperId: 1,
    studentIds: [student.user.id],
    examName: `系统管理考试-${uniqueSuffix()}`,
    durationMinutes: 30,
  });
  await publishExam(teacher.accessToken, exam.id);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await closeBackendPool();
});

describe('健康检查（REQ-SYS-06）', () => {
  test('TC-SYS-001 /health 公开可访问，返回数据库连通与运行时长', async () => {
    const res = await api().get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual(expect.objectContaining({
      status: 'up',
      database: 'connected',
      version: expect.any(String),
      serverTime: expect.any(String),
      uptimeSeconds: expect.any(Number),
      environment: 'test',
    }));
  });
});

describe('系统参数（REQ-SYS-01）', () => {
  test('TC-SYS-010 管理员查询系统参数返回参数清单', async () => {
    const res = await api().get(`${API}/configs`).set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(10);
    expect(res.body.data.find((item) => item.configKey === 'exam.passScore')).toBeTruthy();
  });

  test('TC-SYS-011 修改可编辑参数成功并写审计', async () => {
    const before = await api().get(`${API}/configs`).set(bearer(admin.accessToken));
    const original = before.body.data.find((item) => item.configKey === 'exam.passScore').configValue;

    const update = await api()
      .put(`${API}/configs/exam.passScore`)
      .set(bearer(admin.accessToken))
      .send({ configValue: '55', reason: '集成测试临时调整' });
    expect(update.status).toBe(200);

    const after = await api().get(`${API}/configs`).set(bearer(admin.accessToken));
    expect(after.body.data.find((item) => item.configKey === 'exam.passScore').configValue).toBe('55');

    // 还原，避免影响其他用例
    await api()
      .put(`${API}/configs/exam.passScore`)
      .set(bearer(admin.accessToken))
      .send({ configValue: original, reason: '集成测试还原' })
      .expect(200);

    const audits = await api()
      .get(`${API}/audit-logs`)
      .query({ action: 'config.update' })
      .set(bearer(admin.accessToken));
    expect(audits.status).toBe(200);
    expect(audits.body.data.total).toBeGreaterThanOrEqual(2);
  });

  test('TC-SYS-012 修改不可编辑参数返回 403 / 70101', async () => {
    const res = await api()
      .put(`${API}/configs/security.bcryptCost`)
      .set(bearer(admin.accessToken))
      .send({ configValue: '12' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(70101);
  });

  test('TC-SYS-013【缺陷 BUG-5】参数取值超出业务允许范围应返回 400 / 70102', async () => {
    const before = await api().get(`${API}/configs`).set(bearer(admin.accessToken));
    const original = before.body.data.find((item) => item.configKey === 'security.maxLoginFail').configValue;
    try {
      const res = await api()
        .put(`${API}/configs/security.maxLoginFail`)
        .set(bearer(admin.accessToken))
        .send({ configValue: '9999' });
      // 期望：maxLoginFail 超出 1~10 合理区间 → 70102；实际：仅校验“非负数字”，返回 200
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(70102);
    } finally {
      await api()
        .put(`${API}/configs/security.maxLoginFail`)
        .set(bearer(admin.accessToken))
        .send({ configValue: original, reason: '测试还原' });
    }
  });
});

describe('审计日志（REQ-SYS-04）', () => {
  test('TC-SYS-020 审计日志可查询且包含操作人/模块/动作/结果/耗时', async () => {
    const res = await api()
      .get(`${API}/audit-logs`)
      .query({ page: 1, pageSize: 10, action: 'auth.login' })
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThan(0);
    const row = res.body.data.list[0];
    expect(row).toEqual(expect.objectContaining({
      id: expect.any(Number),
      module: 'uam',
      action: 'auth.login',
      result: expect.any(String),
      createdAt: expect.any(String),
    }));
    // 审计摘要已脱敏：不得出现明文密码
    const text = JSON.stringify(res.body.data.list);
    expect(text).not.toContain('Admin@2026');
    expect(text).not.toContain('Student@2026');
  });

  test('TC-SYS-021 审计日志支持按模块过滤（考试交卷审计存在）', async () => {
    await api()
      .post(`${API}/exams/${exam.id}/attempts`)
      .set(bearer(student.accessToken))
      .send({})
      .then((res) => expect([200, 201]).toContain(res.status));

    const res = await api()
      .get(`${API}/audit-logs`)
      .query({ module: 'exm', action: 'attempt.start' })
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.list[0].requestSummary).toBeTruthy();
  });

  test('TC-SYS-022 审计日志导出返回 CSV 文件流', async () => {
    const res = await api()
      .get(`${API}/audit-logs/export`)
      .set(bearer(admin.accessToken))
      .buffer(true)
      .parse(parseBinary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('audit-logs.csv');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('TC-SYS-023 非管理员查询审计日志返回 403 / 90301', async () => {
    const res = await api().get(`${API}/audit-logs`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });
});

describe('公告与站内通知（REQ-SYS-03）', () => {
  test('TC-SYS-030 管理员创建公告，学生可在公告列表查看', async () => {
    const title = `集成测试公告-${uniqueSuffix()}`;
    const created = await api()
      .post(`${API}/notices`)
      .set(bearer(admin.accessToken))
      .send({ title, content: '这是一条集成测试公告', targetRole: 'all', status: 'published' });
    expect(created.status).toBe(201);

    const list = await api().get(`${API}/notices`).set(bearer(student.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.list.some((item) => item.title === title)).toBe(true);
  });

  test('TC-SYS-031 更新与删除公告', async () => {
    const created = await api()
      .post(`${API}/notices`)
      .set(bearer(admin.accessToken))
      .send({ title: `待更新公告-${uniqueSuffix()}`, content: '初始内容', targetRole: 'student' });
    const noticeId = created.body.data.id;

    const update = await api()
      .put(`${API}/notices/${noticeId}`)
      .set(bearer(admin.accessToken))
      .send({ title: '更新后的公告', content: '更新内容', targetRole: 'student' });
    expect(update.status).toBe(200);
    expect(update.body.data.title).toBe('更新后的公告');

    const del = await api().delete(`${API}/notices/${noticeId}`).set(bearer(admin.accessToken));
    expect(del.status).toBe(200);
  });

  test('TC-SYS-032 考试发布后学生收到站内通知并可标记已读', async () => {
    const list = await api()
      .get(`${API}/notifications`)
      .query({ page: 1, pageSize: 20 })
      .set(bearer(student.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.list.length).toBeGreaterThan(0);

    const target = list.body.data.list.find((item) => item.bizType === 'exam' && item.isRead === false);
    expect(target).toBeTruthy();

    const read = await api()
      .patch(`${API}/notifications/${target.id}/read`)
      .set(bearer(student.accessToken))
      .send({});
    expect(read.status).toBe(200);

    const after = await api()
      .get(`${API}/notifications`)
      .query({ page: 1, pageSize: 20 })
      .set(bearer(student.accessToken));
    expect(after.body.data.list.find((item) => item.id === target.id).isRead).toBe(true);
  });

  test('TC-SYS-033 公告参数非法返回 422 / 90101', async () => {
    const res = await api()
      .post(`${API}/notices`)
      .set(bearer(admin.accessToken))
      .send({ title: '', content: 'x', targetRole: 'all' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });
});

describe('用户与权限管理（REQ-UAM-05/08/09）', () => {
  test('TC-UAM-060 管理员用户列表支持分页与关键词查询', async () => {
    const res = await api()
      .get(`${API}/users`)
      .query({ page: 1, pageSize: 5, keyword: 'S' })
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      list: expect.any(Array), total: expect.any(Number), page: 1, pageSize: 5,
    }));
    expect(res.body.data.list[0].passwordHash).toBeUndefined();
  });

  test('TC-UAM-061 注册申请审批流程：pending 可查、审批通过后可登录', async () => {
    const suffix = uniqueSuffix();
    const username = `S${suffix}`;
    const password = 'Student@2026';
    const register = await api().post(`${API}/auth/register`).send({
      username, realName: '待审批学生', password, classId: 1, email: `pending-${suffix}@oes.test`,
    });
    expect(register.status).toBe(201);
    const userId = register.body.data.userId;

    const pending = await api()
      .get(`${API}/users/pending`)
      .query({ page: 1, pageSize: 100 })
      .set(bearer(admin.accessToken));
    expect(pending.body.data.list.some((item) => item.id === userId)).toBe(true);

    const approve = await api().post(`${API}/users/${userId}/approve`).set(bearer(admin.accessToken)).send({});
    expect(approve.status).toBe(200);

    const loginRes = await api().post(`${API}/auth/login`).send({ username, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.status).toBeUndefined();
  });

  test('TC-UAM-062 注册申请驳回后账号被禁用且不可登录', async () => {
    const suffix = uniqueSuffix();
    const username = `S${suffix}`;
    const password = 'Student@2026';
    const register = await api().post(`${API}/auth/register`).send({
      username, realName: '被驳回学生', password, classId: 1, email: `reject-${suffix}@oes.test`,
    });
    const userId = register.body.data.userId;

    const reject = await api()
      .post(`${API}/users/${userId}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: '资料不完整' });
    expect(reject.status).toBe(200);

    const loginRes = await api().post(`${API}/auth/login`).send({ username, password });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe(10103);
  });

  test('TC-UAM-063 管理员重置密码返回一次性临时密码，且新密码可登录', async () => {
    const created = await createStudent(admin.accessToken);
    const session = await login(created.username, created.password);
    expect(session.accessToken).toBeTruthy();

    const reset = await api()
      .post(`${API}/users/${created.userId}/reset-password`)
      .set(bearer(admin.accessToken))
      .send({});
    expect(reset.status).toBe(200);
    const temporary = reset.body.data.temporaryPassword;
    expect(temporary).toHaveLength(12);

    const loginRes = await api().post(`${API}/auth/login`).send({ username: created.username, password: temporary });
    expect(loginRes.status).toBe(200);

    const oldToken = await api().get(`${API}/auth/me`).set(bearer(session.accessToken));
    expect(oldToken.status).toBe(401);
  });

  test('TC-UAM-064 管理员创建用户缺少班级（学生）返回 422 / 90101', async () => {
    const res = await api()
      .post(`${API}/users`)
      .set(bearer(admin.accessToken))
      .send({ username: `S${uniqueSuffix()}`, realName: '无班级学生', roleCode: 'student' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-UAM-065 角色与权限点字典可查询', async () => {
    const roles = await api().get(`${API}/roles`).set(bearer(admin.accessToken));
    expect(roles.status).toBe(200);
    expect(roles.body.data.map((item) => item.roleCode)).toEqual(expect.arrayContaining(['admin', 'teacher', 'student']));

    const permissions = await api().get(`${API}/permissions`).set(bearer(admin.accessToken));
    expect(permissions.status).toBe(200);
    expect(permissions.body.data.length).toBeGreaterThan(40);
  });

  test('TC-UAM-066 班级字典查询与创建', async () => {
    const list = await api().get(`${API}/classes`).set(bearer(teacher.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);

    const suffix = uniqueSuffix();
    const created = await api()
      .post(`${API}/classes`)
      .set(bearer(admin.accessToken))
      .send({ classCode: `CS-${suffix}`, className: `集成测试班级-${suffix}`, gradeYear: 2026 });
    expect(created.status).toBe(201);
    expect(created.body.data.classCode).toBe(`CS-${suffix}`);
  });
});

describe('统计分析与导出（REQ-STA-04/05/06）', () => {
  test('TC-STA-020 题目质量分析返回逐题正确率与区分度', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/question-analysis`)
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      examId: exam.id,
      examName: exam.examName,
      calculatedAt: expect.any(String),
      questions: expect.any(Array),
    }));
    // 本场考试暂无已交卷答卷 → 逐题分析为空
    expect(res.body.data.questions).toEqual([]);
  });

  test('TC-STA-021 知识点失分分布返回数组（可为空）', async () => {
    const res = await api()
      .get(`${API}/statistics/knowledge-points`)
      .query({ examId: exam.id })
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('TC-STA-022 缺少 examId 查询知识点统计返回 422 / 90101', async () => {
    const res = await api()
      .get(`${API}/statistics/knowledge-points`)
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-STA-023 多场次趋势统计返回 series 与知识点失分', async () => {
    const res = await api()
      .get(`${API}/statistics/trends`)
      .query({ examIds: `${exam.id},1` })
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      series: expect.any(Array),
      knowledgePointLoss: expect.any(Array),
    }));
  });

  test('TC-STA-024 趋势统计缺少 examIds 返回 422 / 90101', async () => {
    const res = await api().get(`${API}/statistics/trends`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-STA-025 学生导出本人成绩单返回 xlsx 文件流', async () => {
    const res = await api()
      .get(`${API}/my/grades/export`)
      .set(bearer(student.accessToken))
      .buffer(true)
      .parse(parseBinary);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('my-grades.xlsx');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('TC-STA-026 考试成绩导出返回 xlsx 文件流', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/scores/export`)
      .set(bearer(teacher.accessToken))
      .buffer(true)
      .parse(parseBinary);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(`exam-${exam.id}-scores.xlsx`);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('TC-STA-027 学生导出他人场次成绩返回 403 / 90302（数据权限）', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/scores/export`)
      .set(bearer(student.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90302);
  });
});

describe('考试任务、监控与变更（REQ-EXM-01/02/10）', () => {
  test('TC-EXM-030 考试任务列表返回分页与任务统计', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/tasks`)
      .query({ page: 1, pageSize: 20 })
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      list: expect.any(Array),
      total: expect.any(Number),
      pending: expect.any(Number),
      doing: expect.any(Number),
      submitted: expect.any(Number),
      missed: expect.any(Number),
    }));
    expect(res.body.data.list[0].studentNo).toBe(SEED.student.username);
  });

  test('TC-EXM-031 防作弊事件列表可按考试查询', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/anti-cheat-events`)
      .query({ page: 1, pageSize: 20 })
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      list: expect.any(Array), total: expect.any(Number),
    }));
  });

  test('TC-EXM-032 补考授权增加作答次数并记录审计', async () => {
    const res = await api()
      .post(`${API}/exams/${exam.id}/grants`)
      .set(bearer(teacher.accessToken))
      .send({ studentIds: [student.user.id], extraAttempts: 1, reason: '集成测试补考' });
    expect(res.status).toBe(200);

    const tasks = await api()
      .get(`${API}/exams/${exam.id}/tasks`)
      .query({ page: 1, pageSize: 20 })
      .set(bearer(teacher.accessToken));
    expect(tasks.body.data.list[0].attemptsAllowed).toBeGreaterThanOrEqual(2);
  });

  test('TC-EXM-033 考试状态变更：取消考试并通知学生', async () => {
    const cancelExam = await createActiveExam(teacher.accessToken, {
      paperId: 1,
      studentIds: [student.user.id],
      examName: `待取消考试-${uniqueSuffix()}`,
    });
    await publishExam(teacher.accessToken, cancelExam.id);

    const res = await api()
      .patch(`${API}/exams/${cancelExam.id}/status`)
      .set(bearer(teacher.accessToken))
      .send({ status: 'cancelled', reason: '教师临时取消' });
    expect(res.status).toBe(200);

    const detail = await api()
      .get(`${API}/exams/${cancelExam.id}`)
      .set(bearer(teacher.accessToken));
    expect(detail.body.data.status).toBe('cancelled');
  });

  test('TC-EXM-034 考试结束时间早于开始时间返回 400 / 40101', async () => {
    const res = await api()
      .post(`${API}/exams`)
      .set(bearer(teacher.accessToken))
      .send({
        examName: `时间非法考试-${uniqueSuffix()}`,
        paperId: 1,
        startTime: new Date(Date.now() + 3600 * 1000).toISOString(),
        endTime: new Date(Date.now() + 1800 * 1000).toISOString(),
        durationMinutes: 30,
        scope: { studentIds: [student.user.id] },
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(40101);
  });

  test('TC-EXM-035 参考范围为空创建考试返回 422 / 40103', async () => {
    const res = await api()
      .post(`${API}/exams`)
      .set(bearer(teacher.accessToken))
      .send({
        examName: `范围为空考试-${uniqueSuffix()}`,
        paperId: 1,
        startTime: new Date(Date.now() - 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 3600 * 1000).toISOString(),
        durationMinutes: 30,
        scope: { studentIds: [], classIds: [] },
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(40103);
  });

  test('TC-EXM-036 已发布考试修改参考范围返回 409 / 40111', async () => {
    const res = await api()
      .put(`${API}/exams/${exam.id}`)
      .set(bearer(teacher.accessToken))
      .send({ scope: { studentIds: [student.user.id] } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40111);
  });
});