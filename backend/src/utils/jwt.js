'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { fail } = require('./errors');

const ACCESS_TYPE = 'access';
const REFRESH_TYPE = 'refresh';

function signAccessToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      roleCode: user.role_code || user.roleCode,
      tokenVersion: Number(user.token_version ?? user.tokenVersion ?? 1),
      type: ACCESS_TYPE,
      jti,
    },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: env.jwtExpiresIn },
  );
  return { token, jti, expiresIn: env.jwtExpiresIn };
}

/** Refresh Token 亦使用 JWT 保护，同时以 SHA-256 摘要落库并支持轮换 */
function signRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      sub: String(user.id),
      type: REFRESH_TYPE,
      jti,
    },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: env.jwtRefreshExpiresIn },
  );
  return { token, jti, expiresIn: env.jwtRefreshExpiresIn };
}

function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw fail(90203);
    throw fail(90202);
  }
  if (payload.type !== ACCESS_TYPE || !payload.sub) throw fail(90202);
  return payload;
}

function verifyRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw fail(10109);
    throw fail(10109);
  }
  if (payload.type !== REFRESH_TYPE || !payload.sub || !payload.jti) throw fail(10109);
  return payload;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** 解析 Bearer 头 */
function extractBearer(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const [scheme, token] = headerValue.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  sha256,
  extractBearer,
};