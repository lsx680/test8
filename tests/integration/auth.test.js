'use strict';

/**
 * 集成测试：认证与账号（REQ-UAM-01~07）
 * 覆盖：注册与审批前置、登录成功/失败、401 未认证、刷新令牌轮换与重放、
 *      改密后旧令牌失效、禁用后令牌失效、连续失败锁定、登出后刷新令牌失效
 */
const { api, login, bearer, API } = require('../helpers/api');
const { loginSeed, createStudent, uniqueSuffix, SEED } = require('../helpers/fixtures');
const { closeBackendPool } = require('../helpers/db');

let adminSession;

beforeAll(async () => {
  adminSession = await loginSeed('admin');
  // 复位登录失败锁定阈值（防止其它测试文件修改系统参数造成顺序依赖）
  await api()
    .put(`${API}/configs/security.maxLoginFail`)
    .set(bearer(adminSession.accessToken))
    .send({ configValue: '5', reason: '测试环境复位' });
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await closeBackendPool();
});

describe('POST /auth/register 学生注册', () => {
  test('TC-UAM-001 注册成功创建 pending 账号，审批前不可登录（REQ-UAM-06）', async () => {
    const suffix = uniqueSuffix();
    const username = `S${suffix}`;
    const email = `reg-${suffix}@oes.test`;

    const registerRes = await api().post(`${API}/auth/register`).send({
      username,
      realName: '注册测试学生',
      password: 'Student@2026',
      classId: 1,
      email,
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.code).toBe(0);
    expect(registerRes.body.data.status).toBe('pending');
    expect(registerRes.body.data.userId).toBeGreaterThan(0);

    const loginRes = await api().post(`${API}/auth/login`).send({ username, password: 'Student@2026' });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe(10102);
  });

  test('TC-UAM-002 用户名重复返回 409 / 10105', async () => {
    const suffix = uniqueSuffix();
    const payload = {
      username: `S${suffix}`,
      realName: '重复学生',
      password: 'Student@2026',
      classId: 1,
      email: `dup-${suffix}@oes.test`,
    };
    await api().post(`${API}/auth/register`).send(payload).expect(201);
    const second = await api().post(`${API}/auth/register`).send({ ...payload, email: `dup2-${suffix}@oes.test` });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe(10105);
  });

  test('TC-UAM-003 密码强度不足返回 422 / 90101', async () => {
    const suffix = uniqueSuffix();
    const res = await api().post(`${API}/auth/register`).send({
      username: `S${suffix}`,
      realName: '弱密码',
      password: '12345678',
      classId: 1,
      email: `weak-${suffix}@oes.test`,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
    expect(res.body.errors.some((item) => item.field === 'password')).toBe(true);
  });

  test('TC-UAM-004 邮箱格式非法返回 422 / 90101', async () => {
    const suffix = uniqueSuffix();
    const res = await api().post(`${API}/auth/register`).send({
      username: `S${suffix}`,
      realName: '邮箱非法',
      password: 'Student@2026',
      classId: 1,
      email: 'not-an-email',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });
});

describe('POST /auth/login 登录', () => {
  test('TC-UAM-010 三种角色登录成功且返回首页路由（REQ-UAM-01）', async () => {
    const cases = [
      ['admin', '/admin/dashboard'],
      ['teacher', '/teacher/dashboard'],
      ['student', '/student/dashboard'],
    ];
    for (const [role, homeRoute] of cases) {
      const data = await login(SEED[role].username, SEED[role].password);
      expect(data.accessToken).toBeTruthy();
      expect(data.refreshToken).toBeTruthy();
      expect(data.tokenType).toBe('Bearer');
      expect(data.homeRoute).toBe(homeRoute);
      expect(data.user.roleCode).toBe(role);
      expect(Array.isArray(data.user.permissions)).toBe(true);
    }
  });

  test('TC-UAM-011 密码错误返回 401 / 10101，且不回显账号是否存在', async () => {
    const wrongPassword = await api()
      .post(`${API}/auth/login`)
      .send({ username: SEED.student.username, password: 'WrongPass1' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.code).toBe(10101);

    const unknownUser = await api()
      .post(`${API}/auth/login`)
      .send({ username: 'not-exist-user', password: 'WrongPass1' });
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.code).toBe(10101);
  });

  test('TC-UAM-012 连续 5 次失败触发账号锁定（423 / 10104，REQ-UAM-02）', async () => {
    const student = await createStudent(adminSession.accessToken);
    let lastStatus = 0;
    let lastCode = 0;
    for (let i = 0; i < 5; i += 1) {
      const res = await api()
        .post(`${API}/auth/login`)
        .send({ username: student.username, password: `WrongPass${i}` });
      lastStatus = res.status;
      lastCode = res.body.code;
    }
    expect(lastStatus).toBe(423);
    expect(lastCode).toBe(10104);

    // 锁定期内即使密码正确也不可登录
    const correct = await api()
      .post(`${API}/auth/login`)
      .send({ username: student.username, password: student.password });
    expect(correct.status).toBe(423);
    expect(correct.body.code).toBe(10104);
    expect(correct.body.data.remainingSeconds).toBeGreaterThan(0);
  });
});

describe('鉴权失败场景', () => {
  test('TC-UAM-020 未携带令牌访问受保护接口返回 401 / 90201', async () => {
    const res = await api().get(`${API}/auth/me`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(90201);
  });

  test('TC-UAM-021 伪造令牌返回 401 / 90202', async () => {
    const res = await api().get(`${API}/auth/me`).set(bearer('forged.token.value'));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(90202);
  });

  test('TC-UAM-022 非 Bearer 方案返回 401', async () => {
    const student = await loginSeed('student');
    const res = await api().get(`${API}/auth/me`).set({ Authorization: `Basic ${student.accessToken}` });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(90201);
  });

  test('TC-UAM-023 登录后 /auth/me 返回本人信息与权限点（REQ-UAM-08）', async () => {
    const session = await loginSeed('student');
    const res = await api().get(`${API}/auth/me`).set(bearer(session.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: session.user.id,
      username: SEED.student.username,
      roleCode: 'student',
    });
    expect(res.body.data.permissions).toContain('attempt.submit');
    expect(res.body.data.permissions).not.toContain('user.create');
  });
});

describe('刷新令牌轮换（REQ-UAM-04）', () => {
  test('TC-UAM-030 刷新成功返回新令牌，旧刷新令牌再次使用返回 401 / 10109', async () => {
    const session = await loginSeed('student');
    const refine = await api().post(`${API}/auth/refresh`).send({ refreshToken: session.refreshToken });
    expect(refine.status).toBe(200);
    expect(refine.body.code).toBe(0);
    const rotated = refine.body.data;
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(session.refreshToken);

    // 新 Access Token 可用
    const me = await api().get(`${API}/auth/me`).set(bearer(rotated.accessToken));
    expect(me.status).toBe(200);

    // 旧刷新令牌已吊销：重放被拒绝
    const replay = await api().post(`${API}/auth/refresh`).send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe(10109);
  });

  test('TC-UAM-031 非法刷新令牌返回 401 / 10109', async () => {
    const res = await api().post(`${API}/auth/refresh`).send({ refreshToken: 'invalid-refresh-token' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(10109);
  });

  test('TC-UAM-032 缺少 refreshToken 字段返回 422 / 90101', async () => {
    const res = await api().post(`${API}/auth/refresh`).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });
});

describe('修改密码后旧令牌失效（REQ-UAM-07）', () => {
  test('TC-UAM-040 改密成功后旧 Access Token 返回 401，新密码可登录、旧密码不可登录', async () => {
    const student = await createStudent(adminSession.accessToken);
    const session = await login(student.username, student.password);
    const newPassword = 'NewPassw0rd9';

    const change = await api()
      .put(`${API}/auth/password`)
      .set(bearer(session.accessToken))
      .send({ oldPassword: student.password, newPassword, confirmPassword: newPassword });
    expect(change.status).toBe(200);
    expect(change.body.code).toBe(0);

    const oldTokenRes = await api().get(`${API}/auth/me`).set(bearer(session.accessToken));
    expect(oldTokenRes.status).toBe(401);
    expect(oldTokenRes.body.code).toBe(90204);

    const oldRefresh = await api().post(`${API}/auth/refresh`).send({ refreshToken: session.refreshToken });
    expect(oldRefresh.status).toBe(401);
    expect(oldRefresh.body.code).toBe(10109);

    const newLogin = await login(student.username, newPassword);
    expect(newLogin.accessToken).toBeTruthy();
    expect(newLogin.user.id).toBe(student.userId);

    const oldPasswordLogin = await api()
      .post(`${API}/auth/login`)
      .send({ username: student.username, password: student.password });
    expect(oldPasswordLogin.status).toBe(401);
    expect(oldPasswordLogin.body.code).toBe(10101);
  });

  test('TC-UAM-041 旧密码错误返回 400 / 10108', async () => {
    const student = await createStudent(adminSession.accessToken);
    const session = await login(student.username, student.password);
    const res = await api()
      .put(`${API}/auth/password`)
      .set(bearer(session.accessToken))
      .send({ oldPassword: 'WrongPass1', newPassword: 'NewPassw0rd9', confirmPassword: 'NewPassw0rd9' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(10108);
  });

  test('TC-UAM-042 两次新密码不一致返回 400 / 10107', async () => {
    const student = await createStudent(adminSession.accessToken);
    const session = await login(student.username, student.password);
    const res = await api()
      .put(`${API}/auth/password`)
      .set(bearer(session.accessToken))
      .send({ oldPassword: student.password, newPassword: 'NewPassw0rd9', confirmPassword: 'OtherPassw0rd9' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(10107);
  });
});

describe('账号状态与登出', () => {
  test('TC-UAM-050 管理员禁用账号后旧 Access Token 立即失效（REQ-UAM-09）', async () => {
    const student = await createStudent(adminSession.accessToken);
    const session = await login(student.username, student.password);

    const disable = await api()
      .patch(`${API}/users/${student.userId}/status`)
      .set(bearer(adminSession.accessToken))
      .send({ status: 'disabled', reason: '集成测试禁用' });
    expect(disable.status).toBe(200);

    const me = await api().get(`${API}/auth/me`).set(bearer(session.accessToken));
    expect(me.status).toBe(403);
    expect(me.body.code).toBe(10103);

    const loginRes = await api()
      .post(`${API}/auth/login`)
      .send({ username: student.username, password: student.password });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe(10103);
  });

  test('TC-UAM-051 登出后刷新令牌不可再使用', async () => {
    const student = await createStudent(adminSession.accessToken);
    const session = await login(student.username, student.password);

    const logout = await api()
      .post(`${API}/auth/logout`)
      .set(bearer(session.accessToken))
      .send({ refreshToken: session.refreshToken });
    expect(logout.status).toBe(200);

    const refreshRes = await api().post(`${API}/auth/refresh`).send({ refreshToken: session.refreshToken });
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.code).toBe(10109);
  });

  test('TC-UAM-052 修改本人资料成功；重复邮箱返回 409 / 10106', async () => {
    const student = await createStudent(adminSession.accessToken);
    const session = await login(student.username, student.password);

    const update = await api()
      .put(`${API}/auth/profile`)
      .set(bearer(session.accessToken))
      .send({ realName: '更新后的姓名' });
    expect(update.status).toBe(200);
    expect(update.body.data.realName).toBe('更新后的姓名');

    const conflict = await api()
      .put(`${API}/auth/profile`)
      .set(bearer(session.accessToken))
      .send({ email: SEED.admin.username === 'admin' ? 'admin@oes.edu.cn' : 'x@oes.test' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe(10106);
  });
});