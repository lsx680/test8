'use strict';

/** 审计日志数据访问层（仅 INSERT，不可篡改） */
const db = require('../config/db');
const { sanitizeForAudit } = require('../utils/mask');

const AUDIT_COLUMNS = `id, user_id, username, role_code, module, action, http_method, path,
  ip, user_agent, request_summary, result, error_code, duration_ms, created_at`;

function mapAudit(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: row.user_id === null ? null : Number(row.user_id),
    username: row.username,
    roleCode: row.role_code,
    module: row.module,
    action: row.action,
    httpMethod: row.http_method,
    path: row.path,
    ip: row.ip,
    userAgent: row.user_agent,
    requestSummary: row.request_summary,
    result: row.result,
    errorCode: row.error_code,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

/**
 * 写审计日志；失败仅记录到控制台，不影响主业务（审计旁路）
 * @param {object} entry 见 sys_audit_log 字段（lowerCamelCase）
 * @param {object|null} conn 事务连接（需要与业务同事务时传入）
 */
async function write(entry, conn = null) {
  let username = entry.username || null;
  let roleCode = entry.roleCode || null;
  // 业务服务通常只传 userId，这里补齐操作人快照（失败不影响审计写入）
  if (entry.userId && (!username || !roleCode)) {
    try {
      const runner = conn || db;
      const rows = conn
        ? (await runner.query('SELECT username, role_code FROM sys_user WHERE id = ? LIMIT 1', [entry.userId]))[0]
        : await runner.query('SELECT username, role_code FROM sys_user WHERE id = ? LIMIT 1', [entry.userId]);
      if (rows && rows[0]) {
        username = username || rows[0].username;
        roleCode = roleCode || rows[0].role_code;
      }
    } catch (err) {
      // 忽略快照补全失败
    }
  }
  const sql = `INSERT INTO sys_audit_log
    (user_id, username, role_code, module, action, http_method, path, ip, user_agent,
     request_summary, result, error_code, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  let summary = entry.requestSummary || null;
  if (summary && typeof summary === 'object') summary = JSON.stringify(sanitizeForAudit(summary));
  const params = [
    entry.userId || null,
    username,
    roleCode,
    entry.module,
    entry.action,
    entry.httpMethod || null,
    entry.path || null,
    entry.ip || null,
    entry.userAgent ? String(entry.userAgent).slice(0, 255) : null,
    summary,
    entry.result || 'success',
    entry.errorCode ? String(entry.errorCode) : null,
    entry.durationMs === undefined ? null : entry.durationMs,
  ];
  try {
    if (conn) {
      await conn.query(sql, params);
    } else {
      await db.query(sql, params);
    }
  } catch (err) {
    // 审计失败不得影响业务响应，仅记录错误
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), msg: 'audit.write.failed', error: err.message }));
  }
}

function buildFilter({ startTime, endTime, userId, action, module, result, username }) {
  const where = ['1 = 1'];
  const params = [];
  if (startTime) {
    where.push('created_at >= ?');
    params.push(new Date(startTime));
  }
  if (endTime) {
    where.push('created_at <= ?');
    params.push(new Date(endTime));
  }
  if (!startTime && !endTime) {
    where.push('created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)');
  }
  if (userId) {
    where.push('user_id = ?');
    params.push(userId);
  }
  if (action) {
    where.push('action LIKE ?');
    params.push(`%${action}%`);
  }
  if (module) {
    where.push('module = ?');
    params.push(module);
  }
  if (result) {
    where.push('result = ?');
    params.push(result);
  }
  if (username) {
    where.push('username LIKE ?');
    params.push(`%${username}%`);
  }
  return { whereSql: where.join(' AND '), params };
}

async function list(filters, { limit, offset }) {
  const { whereSql, params } = buildFilter(filters);
  const sql = `SELECT ${AUDIT_COLUMNS} FROM sys_audit_log
    WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapAudit);
}

async function count(filters) {
  const { whereSql, params } = buildFilter(filters);
  return Number(await db.queryValue(`SELECT COUNT(*) AS total FROM sys_audit_log WHERE ${whereSql}`, params));
}

async function listAll(filters, maxRows = 10000) {
  const { whereSql, params } = buildFilter(filters);
  const sql = `SELECT ${AUDIT_COLUMNS} FROM sys_audit_log
    WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ?`;
  return (await db.query(sql, [...params, maxRows])).map(mapAudit);
}

module.exports = { write, list, count, listAll, mapAudit };