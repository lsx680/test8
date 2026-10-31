'use strict';

/** 知识点数据访问层（两级树） */
const db = require('../config/db');

const KP_COLUMNS = `id, kp_code, kp_name, parent_id, level, sort_order, status, question_count, created_at, updated_at`;

function mapKp(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    kpCode: row.kp_code,
    kpName: row.kp_name,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    level: Number(row.level),
    sortOrder: Number(row.sort_order),
    status: row.status,
    questionCount: Number(row.question_count),
  };
}

async function list(includeArchived = false) {
  let sql = `SELECT ${KP_COLUMNS} FROM kb_knowledge_point WHERE deleted_at IS NULL`;
  if (!includeArchived) sql += ` AND status = 'active'`;
  sql += ' ORDER BY level ASC, sort_order ASC, id ASC';
  return (await db.query(sql)).map(mapKp);
}

async function findById(id) {
  const sql = `SELECT ${KP_COLUMNS} FROM kb_knowledge_point WHERE id = ? AND deleted_at IS NULL LIMIT 1`;
  return mapKp(await db.queryOne(sql, [id]));
}

async function findByParentAndName(parentId, kpName) {
  const sql = `SELECT ${KP_COLUMNS} FROM kb_knowledge_point
    WHERE deleted_at IS NULL AND kp_name = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?) LIMIT 1`;
  return mapKp(await db.queryOne(sql, [kpName, parentId || null, parentId || null]));
}

async function create(payload, userId) {
  const sql = `INSERT INTO kb_knowledge_point
    (kp_code, kp_name, parent_id, level, sort_order, status, question_count, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)`;
  const result = await db.query(sql, [
    payload.kpCode,
    payload.kpName,
    payload.parentId || null,
    payload.level,
    payload.sortOrder || 0,
    payload.status || 'active',
    userId || null,
  ]);
  return Number(result.insertId);
}

async function update(id, payload) {
  const sql = `UPDATE kb_knowledge_point SET kp_name = ?, kp_code = ?, parent_id = ?, level = ?,
      sort_order = ? WHERE id = ? AND deleted_at IS NULL`;
  const result = await db.query(sql, [
    payload.kpName,
    payload.kpCode,
    payload.parentId || null,
    payload.level,
    payload.sortOrder || 0,
    id,
  ]);
  return result.affectedRows;
}

async function updateStatus(id, status) {
  const result = await db.query('UPDATE kb_knowledge_point SET status = ? WHERE id = ? AND deleted_at IS NULL', [status, id]);
  return result.affectedRows;
}

async function countQuestions(kpId) {
  return Number(await db.queryValue(
    'SELECT COUNT(*) AS total FROM qb_question WHERE knowledge_point_id = ? AND deleted_at IS NULL',
    [kpId],
  ));
}

async function refreshQuestionCount(kpId, conn = null) {
  const runner = conn || db;
  const sql = `UPDATE kb_knowledge_point kp SET question_count =
      (SELECT COUNT(*) FROM qb_question q WHERE q.knowledge_point_id = kp.id AND q.deleted_at IS NULL)
    WHERE kp.id = ?`;
  await runner.query(sql, [kpId]);
}

async function generateCode(parentId) {
  if (!parentId) {
    const n = Number(await db.queryValue('SELECT COUNT(*) AS total FROM kb_knowledge_point WHERE parent_id IS NULL'));
    return `KP-${String(n + 1).padStart(2, '0')}`;
  }
  const parent = await findById(parentId);
  const n = Number(await db.queryValue('SELECT COUNT(*) AS total FROM kb_knowledge_point WHERE parent_id = ?', [parentId]));
  return `${parent ? parent.kpCode : 'KP'}-${String(n + 1).padStart(2, '0')}`;
}

module.exports = { list, findById, findByParentAndName, create, update, updateStatus, countQuestions, refreshQuestionCount, generateCode };