'use strict';

const { fail } = require('../utils/errors');
const { extractBearer, verifyAccessToken } = require('../utils/jwt');
const userModel = require('../models/user.model');

/**
 * JWT 认证中间件：验签 → 有效期 → 账号状态 → tokenVersion
 * 设计文档 §3.2.4（2）：任何一项不通过均 401，不区分具体原因（防探测）
 */
async function authenticate(req, res, next) {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) throw fail(90201);
    const payload = verifyAccessToken(token);
    const user = await userModel.findById(payload.sub, { withSecrets: true });
    if (!user) throw fail(90204);
    if (user.status !== 'active') {
      if (user.status === 'pending') throw fail(10102);
      throw fail(10103);
    }
    if (Number(user.tokenVersion) !== Number(payload.tokenVersion)) throw fail(90204);
    req.user = {
      id: user.id,
      username: user.username,
      realName: user.realName,
      roleCode: user.roleCode,
      classId: user.classId,
      tokenVersion: user.tokenVersion,
      jti: payload.jti,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };