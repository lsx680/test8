'use strict';

/**
 * 认证服务：注册、登录（失败锁定）、令牌签发/轮换/吊销、本人资料与改密
 * 依据：设计文档 §3.2
 */
const userModel = require('../models/user.model');
const tokenModel = require('../models/token.model');
const rbacModel = require('../models/rbac.model');
const auditModel = require('../models/audit.model');
const configService = require('./config.service');
const { fail } = require('../utils/errors');
const { hashPassword, comparePassword, isStrongPassword, generateTemporaryPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken, sha256 } = require('../utils/jwt');
const { HOME_ROUTES } = require('../config/constants');
const env = require('../config/env');

async function buildCurrentUser(user) {
  const permissions = await rbacModel.listPermissionCodesByRole(user.roleCode);
  return {
    id: user.id,
    username: user.username,
    realName: user.realName,
    roleCode: user.roleCode,
    classId: user.classId,
    className: user.className,
    permissions,
  };
}

async function issueTokens(user, { ip, userAgent }) {
  const access = signAccessToken(user);
  const refresh = signRefreshToken(user);
  const expiresAt = new Date(Date.now() + env.jwtRefreshExpiresIn * 1000);
  await tokenModel.create({
    userId: user.id,
    jti: refresh.jti,
    tokenHash: sha256(refresh.token),
    expiresAt,
    ip,
    userAgent,
  });
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    tokenType: 'Bearer',
    expiresIn: access.expiresIn,
    refreshExpiresIn: refresh.expiresIn,
  };
}

async function register(payload, { ip }) {
  const existing = await userModel.existsUsernameOrEmail(payload.username, payload.email);
  if (existing) {
    if (existing.email && existing.email === payload.email) throw fail(10106);
    throw fail(10105);
  }
  if (!isStrongPassword(payload.password)) throw fail(10107);
  const classInfo = await userModel.findClassById(payload.classId);
  if (!classInfo) throw fail(90401, { message: '班级不存在' });

  const passwordHash = await hashPassword(payload.password);
  const userId = await userModel.create({
    username: payload.username,
    passwordHash,
    realName: payload.realName,
    email: payload.email,
    phone: payload.phone,
    roleCode: 'student',
    classId: payload.classId,
    status: 'pending',
    registerChannel: 'self',
    remark: '学生自主注册，待管理员审核',
  });
  await auditModel.write({
    userId,
    username: payload.username,
    roleCode: 'student',
    module: 'uam',
    action: 'auth.register',
    ip,
    requestSummary: { username: payload.username, classId: payload.classId },
    result: 'success',
  });
  return { userId, status: 'pending' };
}

async function login({ username, password }, { ip, userAgent }) {
  const user = await userModel.findByUsername(username);
  if (!user) throw fail(10101);

  if (user.status === 'pending') throw fail(10102);
  if (user.status === 'disabled') throw fail(10103);

  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil.getTime() > now) {
    const remainingSeconds = Math.ceil((user.lockedUntil.getTime() - now) / 1000);
    throw fail(10104, { data: { remainingSeconds } });
  }
  // 锁定到期自动解锁
  if (user.lockedUntil && user.lockedUntil.getTime() <= now) {
    await userModel.clearFailures(user.id);
    user.failedAttempts = 0;
    user.lockedUntil = null;
  }

  const matched = await comparePassword(password, user.passwordHash);
  if (!matched) {
    const maxFail = await configService.getNumber('security.maxLoginFail');
    const lockMinutes = await configService.getNumber('security.lockMinutes');
    const failedAttempts = Number(user.failedAttempts || 0) + 1;
    let lockedUntil = null;
    if (failedAttempts >= maxFail) {
      lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
    }
    await userModel.registerFailure(user.id, failedAttempts, lockedUntil);
    await auditModel.write({
      userId: user.id,
      username: user.username,
      roleCode: user.roleCode,
      module: 'uam',
      action: lockedUntil ? 'auth.lock' : 'auth.login',
      ip,
      userAgent,
      result: 'failure',
      errorCode: lockedUntil ? '10104' : '10101',
      requestSummary: { failedAttempts },
    });
    if (lockedUntil) {
      throw fail(10104, { data: { remainingSeconds: Math.round(lockMinutes * 60) } });
    }
    throw fail(10101);
  }

  await userModel.touchLoginSuccess(user.id, ip);
  user.failedAttempts = 0;
  user.lockedUntil = null;

  const tokens = await issueTokens(user, { ip, userAgent });
  const currentUser = await buildCurrentUser(user);

  await auditModel.write({
    userId: user.id,
    username: user.username,
    roleCode: user.roleCode,
    module: 'uam',
    action: 'auth.login',
    ip,
    userAgent,
    result: 'success',
  });

  return { ...tokens, user: currentUser, homeRoute: HOME_ROUTES[user.roleCode] || '/' };
}

async function refresh({ refreshToken }, { ip, userAgent }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw fail(10109);
  }
  const tokenHash = sha256(refreshToken);
  const record = await tokenModel.findValidByHash(tokenHash);
  if (!record || record.jti !== payload.jti) throw fail(10109);

  if (record.revoked_at) {
    // 令牌重放：吊销该用户全部刷新令牌
    await tokenModel.revokeAllForUser(record.user_id, 'replay_detected');
    throw fail(10109);
  }
  if (new Date(record.expires_at).getTime() <= Date.now()) throw fail(10109);

  const user = await userModel.findById(record.user_id, { withSecrets: true });
  if (!user || user.status !== 'active') throw fail(10109);
  if (Number(payload.sub) !== Number(user.id)) throw fail(10109);

  await tokenModel.revoke(record.id, 'rotated');
  const tokens = await issueTokens(user, { ip, userAgent });
  return tokens;
}

async function logout(userId, refreshToken, { ip }) {
  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      if (Number(payload.sub) !== Number(userId)) throw fail(10109);
      await tokenModel.revokeByHash(sha256(refreshToken), 'logout');
    } catch (err) {
      // 令牌已失效也视为登出成功，避免泄露令牌状态
      await tokenModel.revokeByHash(sha256(refreshToken), 'logout');
    }
  } else {
    await tokenModel.revokeAllForUser(userId, 'logout');
  }
  return null;
}

async function me(userId) {
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  return buildCurrentUser(user);
}

async function updateProfile(userId, payload) {
  if (payload.email) {
    const existing = await userModel.findByEmail(payload.email);
    if (existing && existing.id !== Number(userId)) throw fail(10106);
  }
  await userModel.update(userId, payload);
  return me(userId);
}

async function changePassword(userId, { oldPassword, newPassword, confirmPassword }) {
  if (newPassword !== confirmPassword) throw fail(10107, { message: '两次输入的新密码不一致' });
  if (!isStrongPassword(newPassword)) throw fail(10107);
  const user = await userModel.findById(userId, { withSecrets: true });
  if (!user) throw fail(90401);
  const matched = await comparePassword(oldPassword, user.passwordHash);
  if (!matched) throw fail(10108);

  await require('../config/db').withTransaction(async (conn) => {
    await userModel.updatePassword(userId, await hashPassword(newPassword), conn);
    await tokenModel.revokeAllForUser(userId, 'password_changed', conn);
  });
  return null;
}

async function resetPasswordByAdmin(userId) {
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  const temporaryPassword = generateTemporaryPassword(12);
  await require('../config/db').withTransaction(async (conn) => {
    await userModel.updatePassword(userId, await hashPassword(temporaryPassword), conn);
    await tokenModel.revokeAllForUser(userId, 'password_changed', conn);
  });
  return { temporaryPassword };
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  updateProfile,
  changePassword,
  resetPasswordByAdmin,
  buildCurrentUser,
};