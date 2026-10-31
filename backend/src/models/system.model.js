'use strict';

/** 系统管理域：参数、公告、站内通知、备份记录 */
const db = require('../config/db');

/* ------------------------------ 系统参数 ------------------------------ */

function mapConfig(row) {
  return {
    configKey: row.config_key,
    configValue: row.config_value,
    valueType: row.value_type,
    configGroup: row.config_group,
    description: row.description,
    isEditable: Boolean(row.is_editable),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function listConfigs(group) {
  const params = [];
  let sql = `SELECT id, config_key, config_value, value_type, config_group, description, is_editable, updated_at
    FROM sys_config`;
  if (group) {
    sql += ' WHERE config_group = ?';
    params.push(group);
  }
  sql += ' ORDER BY config_group ASC, id ASC';
  return (await db.query(sql, params)).map(mapConfig);
}

async function findConfigByKey(configKey) {
  const sql = `SELECT id, config_key, config_value, value_type, config_group, description, is_editable, updated_at
    FROM sys_config WHERE config_key = ? LIMIT 1`;
  const row = await db.queryOne(sql, [configKey]);
  return row ? { id: Number(row.id), ...mapConfig(row) } : null;
}

async function updateConfigValue(configKey, configValue, userId) {
  const sql = `UPDATE sys_config SET config_value = ?, updated_by = ? WHERE config_key = ?`;
  const result = await db.query(sql, [configValue, userId, configKey]);
  return result.affectedRows;
}

/* ------------------------------ 公告 ------------------------------ */

function mapNotice(row) {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    targetRole: row.target_role,
    status: row.status,
    publishAt: row.publish_at ? new Date(row.publish_at).toISOString() : null,
    expireAt: row.expire_at ? new Date(row.expire_at).toISOString() : null,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function listNotices(roleCode, { limit, offset }) {
  const sql = `SELECT id, title, content, target_role, status, publish_at, expire_at, created_by, created_at
    FROM sys_notice
    WHERE deleted_at IS NULL AND status = 'published'
      AND target_role IN ('all', ?)
      AND (publish_at IS NULL OR publish_at <= UTC_TIMESTAMP(3))
      AND (expire_at IS NULL OR expire_at >= UTC_TIMESTAMP(3))
    ORDER BY COALESCE(publish_at, created_at) DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [roleCode, limit, offset])).map(mapNotice);
}

async function countNotices(roleCode) {
  const sql = `SELECT COUNT(*) AS total FROM sys_notice
    WHERE deleted_at IS NULL AND status = 'published'
      AND target_role IN ('all', ?)
      AND (publish_at IS NULL OR publish_at <= UTC_TIMESTAMP(3))
      AND (expire_at IS NULL OR expire_at >= UTC_TIMESTAMP(3))`;
  return Number(await db.queryValue(sql, [roleCode]));
}

async function findNoticeById(id) {
  const sql = `SELECT id, title, content, target_role, status, publish_at, expire_at, created_by, created_at
    FROM sys_notice WHERE id = ? AND deleted_at IS NULL LIMIT 1`;
  const row = await db.queryOne(sql, [id]);
  return row ? mapNotice(row) : null;
}

async function createNotice(payload, userId) {
  const sql = `INSERT INTO sys_notice (title, content, target_role, status, publish_at, expire_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const result = await db.query(sql, [
    payload.title,
    payload.content,
    payload.targetRole,
    payload.status || 'published',
    payload.publishAt || null,
    payload.expireAt || null,
    userId,
  ]);
  return Number(result.insertId);
}

async function updateNotice(id, payload) {
  const sql = `UPDATE sys_notice SET title = ?, content = ?, target_role = ?, status = ?,
      publish_at = ?, expire_at = ?
    WHERE id = ? AND deleted_at IS NULL`;
  const result = await db.query(sql, [
    payload.title,
    payload.content,
    payload.targetRole,
    payload.status || 'published',
    payload.publishAt || null,
    payload.expireAt || null,
    id,
  ]);
  return result.affectedRows;
}

async function deleteNotice(id) {
  const sql = 'UPDATE sys_notice SET deleted_at = UTC_TIMESTAMP(3), status = ? WHERE id = ? AND deleted_at IS NULL';
  const result = await db.query(sql, ['offline', id]);
  return result.affectedRows;
}

/* ------------------------------ 站内通知 ------------------------------ */

function mapNotification(row) {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    noticeType: row.notice_type,
    bizType: row.biz_type,
    bizId: row.biz_id === null ? null : Number(row.biz_id),
    isRead: Boolean(row.is_read),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function listNotifications(userId, isRead, { limit, offset }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (isRead !== undefined && isRead !== null) {
    where.push('is_read = ?');
    params.push(isRead ? 1 : 0);
  }
  const sql = `SELECT id, title, content, notice_type, biz_type, biz_id, is_read, created_at
    FROM sys_notification WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapNotification);
}

async function countNotifications(userId, isRead) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (isRead !== undefined && isRead !== null) {
    where.push('is_read = ?');
    params.push(isRead ? 1 : 0);
  }
  return Number(await db.queryValue(`SELECT COUNT(*) AS total FROM sys_notification WHERE ${where.join(' AND ')}`, params));
}

async function countUnread(userId) {
  return Number(await db.queryValue('SELECT COUNT(*) AS total FROM sys_notification WHERE user_id = ? AND is_read = 0', [userId]));
}

/** 批量站内通知（事务内可传 conn） */
async function createNotifications(items, conn = null) {
  if (!items || items.length === 0) return 0;
  const sql = `INSERT INTO sys_notification (user_id, title, content, notice_type, biz_type, biz_id)
    VALUES ?`;
  const values = items.map((item) => [
    item.userId,
    item.title,
    item.content || null,
    item.noticeType || 'system',
    item.bizType || null,
    item.bizId || null,
  ]);
  if (conn) {
    const [result] = await conn.query(sql, [values]);
    return result.affectedRows;
  }
  const result = await db.query(sql, [values]);
  return result.affectedRows;
}

async function markNotificationRead(id, userId) {
  const sql = `UPDATE sys_notification SET is_read = 1, read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
    WHERE id = ? AND user_id = ?`;
  const result = await db.query(sql, [id, userId]);
  return result.affectedRows;
}

/* ------------------------------ 备份记录 ------------------------------ */

function mapBackup(row) {
  return {
    id: Number(row.id),
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    triggerType: row.trigger_type,
    status: row.status,
    tableCount: row.table_count === null ? null : Number(row.table_count),
    rowCount: row.row_count === null ? null : Number(row.row_count),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    remark: row.remark,
  };
}

async function listBackups({ limit, offset }) {
  const sql = `SELECT id, file_name, file_path, file_size, trigger_type, status, table_count,
      row_count, started_at, finished_at, remark
    FROM sys_backup_record ORDER BY started_at DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [limit, offset])).map(mapBackup);
}

async function countBackups() {
  return Number(await db.queryValue('SELECT COUNT(*) AS total FROM sys_backup_record'));
}

async function findRunningBackup() {
  const sql = `SELECT id, file_name, file_path, file_size, trigger_type, status, table_count,
      row_count, started_at, finished_at, remark
    FROM sys_backup_record WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`;
  const row = await db.queryOne(sql);
  return row ? mapBackup(row) : null;
}

async function createBackup(payload) {
  const sql = `INSERT INTO sys_backup_record
    (file_name, file_path, trigger_type, status, table_count, row_count, operator_id, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const result = await db.query(sql, [
    payload.fileName,
    payload.filePath,
    payload.triggerType || 'manual',
    payload.status || 'running',
    payload.tableCount || null,
    payload.rowCount || null,
    payload.operatorId || null,
    payload.remark || null,
  ]);
  return Number(result.insertId);
}

async function finishBackup(id, { status, fileSize, remark }) {
  const sql = `UPDATE sys_backup_record SET status = ?, file_size = ?, remark = ?,
      finished_at = UTC_TIMESTAMP(3) WHERE id = ?`;
  await db.query(sql, [status, fileSize || null, remark || null, id]);
}

async function findBackupById(id) {
  const sql = `SELECT id, file_name, file_path, file_size, trigger_type, status, table_count,
      row_count, started_at, finished_at, remark
    FROM sys_backup_record WHERE id = ? LIMIT 1`;
  const row = await db.queryOne(sql, [id]);
  return row ? mapBackup(row) : null;
}

async function listBackupsForPrune(keepCount) {
  const sql = `SELECT id, file_path FROM sys_backup_record
    WHERE status = 'success' ORDER BY started_at DESC LIMIT 100 OFFSET ?`;
  return db.query(sql, [keepCount]);
}

module.exports = {
  listConfigs,
  findConfigByKey,
  updateConfigValue,
  mapNotice,
  listNotices,
  countNotices,
  findNoticeById,
  createNotice,
  updateNotice,
  deleteNotice,
  mapNotification,
  listNotifications,
  countNotifications,
  countUnread,
  createNotifications,
  markNotificationRead,
  mapBackup,
  listBackups,
  countBackups,
  findRunningBackup,
  createBackup,
  finishBackup,
  findBackupById, listBackupsForPrune,
};