'use strict';

/**
 * 用户与班级数据访问层（参数化 SQL，禁止 SELECT *）
 * 列 snake_case → 对象 lowerCamelCase 的映射在此完成
 */
const db = require('../config/db');

const USER_COLUMNS = `u.id, u.username, u.password_hash, u.real_name, u.email, u.phone,
  u.role_code, u.class_id, u.department, u.status, u.register_channel,
  u.failed_attempts, u.locked_until, u.token_version, u.password_changed_at,
  u.last_login_at, u.last_login_ip, u.remark, u.created_by, u.created_at, u.updated_at,
  c.class_name`;

const FROM_USER = 'FROM sys_user u LEFT JOIN sys_class c ON c.id = u.class_id AND c.deleted_at IS NULL';

function mapUser(row, withSecrets = false) {
  if (!row) return null;
  const user = {
    id: Number(row.id),
    username: row.username,
    realName: row.real_name,
    email: row.email,
    phone: row.phone,
    roleCode: row.role_code,
    classId: row.class_id === null ? null : Number(row.class_id),
    className: row.class_name || null,
    department: row.department,
    status: row.status,
    registerChannel: row.register_channel,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    remark: row.remark,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
  if (withSecrets) {
    user.passwordHash = row.password_hash;
    user.tokenVersion = Number(row.token_version);
    user.failedAttempts = Number(row.failed_attempts);
    user.lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
    user.deletedAt = null;
  }
  return user;
}

async function findById(id, { withSecrets = false, conn = null } = {}) {
  const sql = `SELECT ${USER_COLUMNS} ${FROM_USER} WHERE u.id = ? AND u.deleted_at IS NULL LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [id]))[0] : await db.query(sql, [id]);
  return mapUser(rows[0], withSecrets);
}

async function findByUsername(username) {
  const sql = `SELECT ${USER_COLUMNS} ${FROM_USER} WHERE u.username = ? AND u.deleted_at IS NULL LIMIT 1`;
  return mapUser(await db.queryOne(sql, [username]), true);
}

async function findByEmail(email) {
  const sql = `SELECT ${USER_COLUMNS} ${FROM_USER} WHERE u.email = ? AND u.deleted_at IS NULL LIMIT 1`;
  return mapUser(await db.queryOne(sql, [email]), true);
}

async function existsUsernameOrEmail(username, email) {
  const sql = `SELECT username, email FROM sys_user
    WHERE deleted_at IS NULL AND (username = ? OR (? IS NOT NULL AND email = ?)) LIMIT 1`;
  const row = await db.queryOne(sql, [username, email || null, email || null]);
  return row || null;
}

async function create(payload, conn = null) {
  const sql = `INSERT INTO sys_user
    (username, password_hash, real_name, email, phone, role_code, class_id, department,
     status, register_channel, failed_attempts, token_version, remark, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`;
  const params = [
    payload.username,
    payload.passwordHash,
    payload.realName,
    payload.email || null,
    payload.phone || null,
    payload.roleCode,
    payload.classId || null,
    payload.department || null,
    payload.status || 'pending',
    payload.registerChannel || 'admin',
    payload.remark || null,
    payload.createdBy || null,
  ];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }
  const result = await db.query(sql, params);
  return Number(result.insertId);
}

const UPDATABLE_FIELDS = {
  realName: 'real_name',
  email: 'email',
  phone: 'phone',
  classId: 'class_id',
  department: 'department',
  remark: 'remark',
};

async function update(id, payload, conn = null) {
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      sets.push(`${column} = ?`);
      params.push(payload[key] === undefined ? null : payload[key]);
    }
  }
  if (sets.length === 0) return 0;
  params.push(id);
  const sql = `UPDATE sys_user SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`;
  if (conn) {
    const [result] = await conn.query(sql, params);
    return result.affectedRows;
  }
  const result = await db.query(sql, params);
  return result.affectedRows;
}

async function updatePassword(id, passwordHash, conn = null) {
  const sql = `UPDATE sys_user
    SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(3),
        token_version = token_version + 1, failed_attempts = 0, locked_until = NULL
    WHERE id = ? AND deleted_at IS NULL`;
  if (conn) {
    const [result] = await conn.query(sql, [passwordHash, id]);
    return result.affectedRows;
  }
  const result = await db.query(sql, [passwordHash, id]);
  return result.affectedRows;
}

async function updateStatus(id, status, reason, conn = null) {
  // 禁用/启用均使旧令牌失效；reason 写入 remark 便于审计追溯
  const sql = `UPDATE sys_user
    SET status = ?, token_version = token_version + 1,
        remark = COALESCE(?, remark), failed_attempts = 0, locked_until = NULL
    WHERE id = ? AND deleted_at IS NULL`;
  if (conn) {
    const [result] = await conn.query(sql, [status, reason || null, id]);
    return result.affectedRows;
  }
  const result = await db.query(sql, [status, reason || null, id]);
  return result.affectedRows;
}

async function updateRole(id, roleCode, classNameUnused, conn = null) {
  const sql = `UPDATE sys_user SET role_code = ?, token_version = token_version + 1
    WHERE id = ? AND deleted_at IS NULL`;
  if (conn) {
    const [result] = await conn.query(sql, [roleCode, id]);
    return result.affectedRows;
  }
  const result = await db.query(sql, [roleCode, id]);
  return result.affectedRows;
}

async function touchLoginSuccess(id, ip) {
  const sql = `UPDATE sys_user
    SET last_login_at = UTC_TIMESTAMP(3), last_login_ip = ?, failed_attempts = 0, locked_until = NULL
    WHERE id = ?`;
  await db.query(sql, [ip || null, id]);
}

async function registerFailure(id, failedAttempts, lockedUntil) {
  const sql = `UPDATE sys_user SET failed_attempts = ?, locked_until = ? WHERE id = ?`;
  await db.query(sql, [failedAttempts, lockedUntil, id]);
}

async function clearFailures(id) {
  await db.query('UPDATE sys_user SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [id]);
}

function buildUserFilter({ keyword, roleCode, status, classId }) {
  const where = ['u.deleted_at IS NULL'];
  const params = [];
  if (keyword) {
    where.push('(u.username LIKE ? OR u.real_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (roleCode) {
    where.push('u.role_code = ?');
    params.push(roleCode);
  }
  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (classId) {
    where.push('u.class_id = ?');
    params.push(classId);
  }
  return { whereSql: where.join(' AND '), params };
}

async function list(filters, { limit, offset }) {
  const { whereSql, params } = buildUserFilter(filters);
  const sql = `SELECT ${USER_COLUMNS} ${FROM_USER} WHERE ${whereSql}
    ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`;
  const rows = await db.query(sql, [...params, limit, offset]);
  return rows.map((row) => mapUser(row));
}

async function count(filters) {
  const { whereSql, params } = buildUserFilter(filters);
  const sql = `SELECT COUNT(*) AS total FROM sys_user u WHERE ${whereSql}`;
  return Number(await db.queryValue(sql, params));
}

async function listPending({ limit, offset }) {
  const sql = `SELECT ${USER_COLUMNS} ${FROM_USER}
    WHERE u.deleted_at IS NULL AND u.status = 'pending' AND u.register_channel = 'self'
      AND u.role_code = 'student'
    ORDER BY u.created_at ASC LIMIT ? OFFSET ?`;
  const rows = await db.query(sql, [limit, offset]);
  return rows.map((row) => mapUser(row));
}

async function countPending() {
  const sql = `SELECT COUNT(*) AS total FROM sys_user
    WHERE deleted_at IS NULL AND status = 'pending' AND register_channel = 'self' AND role_code = 'student'`;
  return Number(await db.queryValue(sql));
}

async function approve(id) {
  const sql = `UPDATE sys_user SET status = 'active', remark = NULL
    WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`;
  const result = await db.query(sql, [id]);
  return result.affectedRows;
}

async function reject(id, reason) {
  const sql = `UPDATE sys_user SET status = 'disabled', remark = ?
    WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`;
  // 占位符顺序为 remark → id，参数必须按同一顺序传入
  const result = await db.query(sql, [reason, id]);
  return result.affectedRows;
}

async function countLoginFailuresSince(userId, sinceDate) {
  const sql = `SELECT COUNT(*) AS total FROM sys_audit_log
    WHERE user_id = ? AND action = 'auth.login' AND result = 'failure' AND created_at >= ?`;
  return Number(await db.queryValue(sql, [userId, sinceDate]));
}

/* ------------------------------ 班级 ------------------------------ */

function mapClass(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    classCode: row.class_code,
    className: row.class_name,
    gradeYear: Number(row.grade_year),
    department: row.department,
    headTeacherId: row.head_teacher_id === null ? null : Number(row.head_teacher_id),
    studentCount: Number(row.student_count || 0),
  };
}

async function listClasses() {
  const sql = `SELECT c.id, c.class_code, c.class_name, c.grade_year, c.department, c.head_teacher_id,
      (SELECT COUNT(*) FROM sys_user u WHERE u.class_id = c.id AND u.role_code = 'student'
        AND u.deleted_at IS NULL AND u.status = 'active') AS student_count
    FROM sys_class c WHERE c.deleted_at IS NULL AND c.status = 1
    ORDER BY c.grade_year DESC, c.class_code ASC`;
  return (await db.query(sql)).map(mapClass);
}

async function findClassById(id) {
  const sql = `SELECT c.id, c.class_code, c.class_name, c.grade_year, c.department, c.head_teacher_id,
      (SELECT COUNT(*) FROM sys_user u WHERE u.class_id = c.id AND u.role_code = 'student'
        AND u.deleted_at IS NULL AND u.status = 'active') AS student_count
    FROM sys_class c WHERE c.id = ? AND c.deleted_at IS NULL LIMIT 1`;
  return mapClass(await db.queryOne(sql, [id]));
}

async function createClass(payload) {
  const sql = `INSERT INTO sys_class (class_code, class_name, grade_year, department, head_teacher_id, status)
    VALUES (?, ?, ?, ?, ?, 1)`;
  const result = await db.query(sql, [
    payload.classCode,
    payload.className,
    payload.gradeYear,
    payload.department || null,
    payload.headTeacherId || null,
  ]);
  return Number(result.insertId);
}

async function findStudentsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const sql = `SELECT u.id, u.username, u.real_name, u.class_id, c.class_name
    FROM sys_user u LEFT JOIN sys_class c ON c.id = u.class_id
    WHERE u.id IN (${placeholders}) AND u.role_code = 'student' AND u.deleted_at IS NULL`;
  return (await db.query(sql, ids)).map((row) => ({
    id: Number(row.id),
    username: row.username,
    realName: row.real_name,
    classId: row.class_id === null ? null : Number(row.class_id),
    className: row.class_name || null,
  }));
}

async function listStudentIdsByClasses(classIds) {
  if (!classIds || classIds.length === 0) return [];
  const placeholders = classIds.map(() => '?').join(',');
  const sql = `SELECT id FROM sys_user
    WHERE class_id IN (${placeholders}) AND role_code = 'student'
      AND status = 'active' AND deleted_at IS NULL`;
  return (await db.query(sql, classIds)).map((row) => Number(row.id));
}

module.exports = {
  mapUser,
  findById,
  findByUsername,
  findByEmail,
  existsUsernameOrEmail,
  create,
  update,
  updatePassword,
  updateStatus,
  updateRole,
  touchLoginSuccess,
  registerFailure,
  clearFailures,
  list,
  count,
  listPending,
  countPending,
  approve,
  reject,
  countLoginFailuresSince,
  listClasses,
  findClassById,
  createClass,
  findStudentsByIds,
  listStudentIdsByClasses,
};