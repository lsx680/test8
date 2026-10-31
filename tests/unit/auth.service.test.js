'use strict';

/**
 * 单元测试：认证服务业务逻辑（数据访问层全部 mock，不依赖真实数据库）
 * 需求追溯：REQ-UAM-01 登录、REQ-UAM-02 失败锁定、REQ-UAM-04 令牌轮换、
 *          REQ-UAM-05 注册审批、REQ-UAM-07 修改密码
 */
const userModel = require('../../backend/src/models/user.model');
const tokenModel = require('../../backend/src/models/token.model');
const rbacModel = require('../../backend/src/models/rbac.model');
const auditModel = require('../../backend/src/models/audit.model');
const configService = require('../../backend/src/services/config.service');
const db = require('../../backend/src/config/db');
const { hashPassword, comparePassword } = require('../../backend/src/utils/password');
const authService = require('../../backend/src/services/auth.service');

jest.mock('../../backend/src/models/user.model');
jest.mock('../../backend/src/models/token.model');
jest.mock('../../backend/src/models/rbac.model');
jest.mock('../../backend/src/models/audit.model');
jest.mock('../../backend/src/services/config.service');
jest.mock('../../backend/src/config/db');

const MOCK_CONN = { query: jest.fn() };

let activeUser;
let passwordHash;

beforeAll(async () => {
  passwordHash = await hashPassword('Passw0rd');
});

beforeEach(() => {
  jest.clearAllMocks();
  activeUser = {
    id: 7,
    username: 'S2024007',
    realName: '测试学生',
    roleCode: 'student',
    classId: 1,
    className: 'CS2024-01',
    status: 'active',
    tokenVersion: 1,
    failedAttempts: 0,
    lockedUntil: null,
    passwordHash,
  };
  db.withTransaction.mockImplementation(async (fn) => fn(MOCK_CONN));
  rbacModel.listPermissionCodesByRole.mockResolvedValue(['auth.me', 'attempt.start']);
  tokenModel.create.mockResolvedValue(1);
  auditModel.write.mockResolvedValue(true);
  configService.getNumber.mockImplementation(async (key) => {
    if (key === 'security.maxLoginFail') return 5;
    if (key === 'security.lockMinutes') return 15;
    return 0;
  });
});

describe('登录 login', () => {
  test('TC-ASV-001 登录成功返回双令牌、用户信息与首页路由', async () => {
    userModel.findByUsername.mockResolvedValue(activeUser);

    const result = await authService.login(
      { username: 'S2024007', password: 'Passw0rd' },
      { ip: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.tokenType).toBe('Bearer');
    expect(result.homeRoute).toBe('/student/dashboard');
    expect(result.user).toMatchObject({
      id: 7, username: 'S2024007', roleCode: 'student', classId: 1,
    });
    expect(result.user.permissions).toContain('attempt.start');
    expect(tokenModel.create).toHaveBeenCalledTimes(1);
    expect(userModel.touchLoginSuccess).toHaveBeenCalledWith(7, '127.0.0.1');
    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login', result: 'success' }));
  });

  test('TC-ASV-002 用户不存在返回 10101（401）', async () => {
    userModel.findByUsername.mockResolvedValue(null);
    await expect(authService.login({ username: 'nobody', password: 'x' }, { ip: '1', userAgent: 'jest' }))
      .rejects.toMatchObject({ code: 10101, httpStatus: 401 });
  });

  test('TC-ASV-003 待审核账号返回 10102（403）', async () => {
    userModel.findByUsername.mockResolvedValue({ ...activeUser, status: 'pending' });
    await expect(authService.login({ username: 'S2024007', password: 'Passw0rd' }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10102, httpStatus: 403 });
  });

  test('TC-ASV-004 禁用账号返回 10103（403）', async () => {
    userModel.findByUsername.mockResolvedValue({ ...activeUser, status: 'disabled' });
    await expect(authService.login({ username: 'S2024007', password: 'Passw0rd' }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10103, httpStatus: 403 });
  });

  test('TC-ASV-005 账号处于锁定期返回 10104（423）并带剩余秒数', async () => {
    userModel.findByUsername.mockResolvedValue({
      ...activeUser,
      lockedUntil: new Date(Date.now() + 60 * 1000),
    });
    await expect(authService.login({ username: 'S2024007', password: 'Passw0rd' }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10104, httpStatus: 423, data: { remainingSeconds: expect.any(Number) } });
  });

  test('TC-ASV-006 密码错误累计失败次数，未达阈值返回 10101', async () => {
    userModel.findByUsername.mockResolvedValue({ ...activeUser, failedAttempts: 1 });
    await expect(authService.login({ username: 'S2024007', password: 'wrong' }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10101 });
    expect(userModel.registerFailure).toHaveBeenCalledWith(7, 2, null);
  });

  test('TC-ASV-007 连续失败达到 5 次触发锁定（10104）', async () => {
    userModel.findByUsername.mockResolvedValue({ ...activeUser, failedAttempts: 4 });
    await expect(authService.login({ username: 'S2024007', password: 'wrong' }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10104 });
    const [, attempts, lockedUntil] = userModel.registerFailure.mock.calls[0];
    expect(attempts).toBe(5);
    expect(lockedUntil).toBeInstanceOf(Date);
    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.lock' }));
  });

  test('TC-ASV-008 锁定到期自动清零失败计数后允许登录', async () => {
    userModel.findByUsername.mockResolvedValue({
      ...activeUser,
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() - 1000),
    });
    const result = await authService.login({ username: 'S2024007', password: 'Passw0rd' }, { ip: '1' });
    expect(result.accessToken).toBeTruthy();
    expect(userModel.clearFailures).toHaveBeenCalledWith(7);
  });
});

describe('刷新令牌 refresh', () => {
  function enableRefreshToken(user) {
    const { signRefreshToken } = require('../../backend/src/utils/jwt');
    const signed = signRefreshToken(user);
    tokenModel.findValidByHash.mockResolvedValue({
      id: 3,
      user_id: user.id,
      jti: signed.jti,
      revoked_at: null,
      expires_at: new Date(Date.now() + 3600 * 1000),
    });
    return signed.token;
  }

  test('TC-ASV-020 刷新成功：吊销旧令牌并签发新令牌（轮换）', async () => {
    const refreshToken = enableRefreshToken(activeUser);
    userModel.findById.mockResolvedValue(activeUser);

    const result = await authService.refresh({ refreshToken }, { ip: '1', userAgent: 'jest' });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).not.toBe(refreshToken);
    expect(tokenModel.revoke).toHaveBeenCalledWith(3, 'rotated');
    expect(tokenModel.create).toHaveBeenCalledTimes(1);
  });

  test('TC-ASV-021 刷新令牌不存在返回 10109（401）', async () => {
    const { signRefreshToken } = require('../../backend/src/utils/jwt');
    const { token } = signRefreshToken(activeUser);
    tokenModel.findValidByHash.mockResolvedValue(null);
    await expect(authService.refresh({ refreshToken: token }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10109, httpStatus: 401 });
  });

  test('TC-ASV-022 已吊销令牌重放：吊销该用户全部刷新令牌并拒绝', async () => {
    const refreshToken = enableRefreshToken(activeUser);
    const { signRefreshToken } = require('../../backend/src/utils/jwt');
    const signed = signRefreshToken(activeUser);
    tokenModel.findValidByHash.mockResolvedValue({
      id: 3,
      user_id: activeUser.id,
      jti: signed.jti,
      revoked_at: new Date(),
      expires_at: new Date(Date.now() + 3600 * 1000),
    });
    await expect(authService.refresh({ refreshToken: signed.token }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10109 });
    expect(tokenModel.revokeAllForUser).toHaveBeenCalledWith(activeUser.id, 'replay_detected');
    expect(refreshToken).toBeTruthy();
  });

  test('TC-ASV-023 无签名/非法刷新令牌返回 10109', async () => {
    await expect(authService.refresh({ refreshToken: 'not-a-jwt' }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10109 });
  });

  test('TC-ASV-024 令牌已过期（数据库记录过期）返回 10109', async () => {
    const { signRefreshToken } = require('../../backend/src/utils/jwt');
    const signed = signRefreshToken(activeUser);
    tokenModel.findValidByHash.mockResolvedValue({
      id: 3,
      user_id: activeUser.id,
      jti: signed.jti,
      revoked_at: null,
      expires_at: new Date(Date.now() - 1000),
    });
    await expect(authService.refresh({ refreshToken: signed.token }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10109 });
  });
});

describe('修改密码 changePassword', () => {
  test('TC-ASV-030 两次新密码不一致返回 10107', async () => {
    await expect(authService.changePassword(7, {
      oldPassword: 'Passw0rd', newPassword: 'NewPassw0rd1', confirmPassword: 'OtherPassw0rd1',
    })).rejects.toMatchObject({ code: 10107 });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('TC-ASV-031 新密码强度不足返回 10107', async () => {
    await expect(authService.changePassword(7, {
      oldPassword: 'Passw0rd', newPassword: 'weak', confirmPassword: 'weak',
    })).rejects.toMatchObject({ code: 10107 });
  });

  test('TC-ASV-032 旧密码不正确返回 10108', async () => {
    userModel.findById.mockResolvedValue(activeUser);
    await expect(authService.changePassword(7, {
      oldPassword: 'WrongPass1', newPassword: 'NewPassw0rd1', confirmPassword: 'NewPassw0rd1',
    })).rejects.toMatchObject({ code: 10108, httpStatus: 400 });
  });

  test('TC-ASV-033 修改成功：更新哈希并吊销全部刷新令牌（旧 Access Token 因 tokenVersion 自增失效）', async () => {
    userModel.findById.mockResolvedValue(activeUser);
    userModel.updatePassword.mockResolvedValue(1);
    tokenModel.revokeAllForUser.mockResolvedValue(2);

    await authService.changePassword(7, {
      oldPassword: 'Passw0rd', newPassword: 'NewPassw0rd1', confirmPassword: 'NewPassw0rd1',
    });

    expect(userModel.updatePassword).toHaveBeenCalledWith(
      7,
      expect.stringMatching(/^\$2/),
      MOCK_CONN,
    );
    expect(tokenModel.revokeAllForUser).toHaveBeenCalledWith(7, 'password_changed', MOCK_CONN);
    expect(await comparePassword('NewPassw0rd1', userModel.updatePassword.mock.calls[0][1])).toBe(true);
  });

  test('TC-ASV-034 用户不存在返回 90401（404）', async () => {
    userModel.findById.mockResolvedValue(null);
    await expect(authService.changePassword(999, {
      oldPassword: 'Passw0rd', newPassword: 'NewPassw0rd1', confirmPassword: 'NewPassw0rd1',
    })).rejects.toMatchObject({ code: 90401, httpStatus: 404 });
  });
});

describe('注册申请 register', () => {
  const payload = {
    username: 'S2024099',
    realName: '新同学',
    password: 'Student@2026',
    classId: 1,
    email: 'new@oes.test',
  };

  test('TC-ASV-040 用户名已存在返回 10105（409）', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue({ username: 'S2024099', email: 'other@oes.test' });
    await expect(authService.register(payload, { ip: '1' }))
      .rejects.toMatchObject({ code: 10105, httpStatus: 409 });
  });

  test('TC-ASV-041 邮箱已存在返回 10106（409）', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue({ username: 'other', email: payload.email });
    await expect(authService.register(payload, { ip: '1' }))
      .rejects.toMatchObject({ code: 10106, httpStatus: 409 });
  });

  test('TC-ASV-042 密码强度不足返回 10107', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue(null);
    await expect(authService.register({ ...payload, password: '12345678' }, { ip: '1' }))
      .rejects.toMatchObject({ code: 10107 });
  });

  test('TC-ASV-043 班级不存在返回 90401', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue(null);
    userModel.findClassById.mockResolvedValue(null);
    await expect(authService.register({ ...payload, classId: 999 }, { ip: '1' }))
      .rejects.toMatchObject({ code: 90401 });
  });

  test('TC-ASV-044 注册成功创建 pending 学生账号并写审计', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue(null);
    userModel.findClassById.mockResolvedValue({ id: 1 });
    userModel.create.mockResolvedValue(55);

    const result = await authService.register(payload, { ip: '127.0.0.1' });

    expect(result).toEqual({ userId: 55, status: 'pending' });
    expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({
      username: 'S2024099',
      roleCode: 'student',
      status: 'pending',
      registerChannel: 'self',
      passwordHash: expect.stringMatching(/^\$2/),
    }));
    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.register' }));
  });
});
/**
 * BUG-4（注册驳回 500）回归：驳回链路的前提是注册必须产出待审核（pending）账号，
 * 且审核动作不得绕过审计。驳回的 SQL 参数顺序由 tests/unit/user.model.test.js
 * 与 tests/unit/user.service.test.js 直接覆盖（见对应文件的 TC-UMD-* / TC-USV-*）。
 */
describe('注册审核前置条件（BUG-4 回归）', () => {
  const reviewPayload = {
    username: 'S2024100',
    realName: '待审核学生',
    password: 'Student@2026',
    classId: 2,
    email: 'pending@oes.test',
    phone: '13800000000',
  };

  test('TC-ASV-045 注册成功创建 pending 账号且不下发任何令牌（可进入审批驳回队列）', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue(null);
    userModel.findClassById.mockResolvedValue({ id: 2 });
    userModel.create.mockResolvedValue(88);

    const result = await authService.register(reviewPayload, { ip: '10.0.0.8' });

    expect(result).toEqual({ userId: 88, status: 'pending' });
    expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      registerChannel: 'self',
      roleCode: 'student',
      classId: 2,
      remark: expect.stringContaining('待管理员审核'),
    }));
    // 待审核账号不签发令牌，避免绕过审批直接使用系统
    expect(tokenModel.create).not.toHaveBeenCalled();
  });

  test('TC-ASV-046 注册审计记录包含 userId/用户名/班级/操作 IP，便于审批追溯', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue(null);
    userModel.findClassById.mockResolvedValue({ id: 2 });
    userModel.create.mockResolvedValue(88);

    await authService.register(reviewPayload, { ip: '10.0.0.8' });

    expect(auditModel.write).toHaveBeenCalledWith({
      userId: 88,
      username: 'S2024100',
      roleCode: 'student',
      module: 'uam',
      action: 'auth.register',
      ip: '10.0.0.8',
      requestSummary: { username: 'S2024100', classId: 2 },
      result: 'success',
    });
  });

  test('TC-ASV-047 注册校验失败（班级不存在）不创建账号、不写审计', async () => {
    userModel.existsUsernameOrEmail.mockResolvedValue(null);
    userModel.findClassById.mockResolvedValue(null);

    await expect(authService.register({ ...reviewPayload, classId: 999 }, { ip: '1' }))
      .rejects.toMatchObject({ code: 90401, message: '班级不存在' });

    expect(userModel.create).not.toHaveBeenCalled();
    expect(auditModel.write).not.toHaveBeenCalled();
  });
});