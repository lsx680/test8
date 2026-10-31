'use strict';

/** 刷新令牌白名单（仅存 SHA-256 摘要 + jti） */
const db = require('../config/db');

async function create({ userId, jti, tokenHash, expiresAt, ip, userAgent }, conn = null) {
  const sql = `INSERT INTO sys_refresh_token (user_id, jti, token_hash, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)`;
  const params = [userId, jti, tokenHash, expiresAt, ip || null, userAgent ? String(userAgent).slice(0, 255) : null];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }
  const result = await db.query(sql, params);
  return Number(result.insertId);
}

async function findValidByHash(tokenHash) {
  const sql = `SELECT id, user_id, jti, token_hash, expires_at, revoked_at
    FROM sys_refresh_token WHERE token_hash = ? LIMIT 1`;
  return db.queryOne(sql, [tokenHash]);
}

async function revoke(id, reason, conn = null) {
  const sql = 'UPDATE sys_refresh_token SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = ? WHERE id = ? AND revoked_at IS NULL';
  if (conn) {
    const [result] = await conn.query(sql, [reason, id]);
    return result.affectedRows;
  }
  const result = await db.query(sql, [reason, id]);
  return result.affectedRows;
}

async function revokeByHash(tokenHash, reason) {
  const sql = 'UPDATE sys_refresh_token SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = ? WHERE token_hash = ? AND revoked_at IS NULL';
  const result = await db.query(sql, [reason, tokenHash]);
  return result.affectedRows;
}

async function revokeAllForUser(userId, reason, conn = null) {
  const sql = `UPDATE sys_refresh_token SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = ?
    WHERE user_id = ? AND revoked_at IS NULL`;
  if (conn) {
    const [result] = await conn.query(sql, [reason, userId]);
    return result.affectedRows;
  }
  const result = await db.query(sql, [reason, userId]);
  return result.affectedRows;
}

module.exports = { create, findValidByHash, revoke, revokeByHash, revokeAllForUser };