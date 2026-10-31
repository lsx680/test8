'use strict';

/** 试卷与试卷题目数据访问层 */
const db = require('../config/db');
const { parseJson, toNum } = require('../utils/mask');

const PAPER_COLUMNS = `p.id, p.paper_no, p.paper_name, p.owner_id, p.assembly_mode, p.total_score,
  p.question_count, p.duration_minutes, p.used_count, p.status, p.description, p.created_at, p.updated_at,
  u.real_name AS owner_name`;

const PAPER_FROM = 'FROM pp_paper p JOIN sys_user u ON u.id = p.owner_id';

function mapPaper(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    paperNo: row.paper_no,
    paperName: row.paper_name,
    ownerId: Number(row.owner_id),
    ownerName: row.owner_name,
    assemblyMode: row.assembly_mode,
    totalScore: toNum(row.total_score),
    questionCount: Number(row.question_count),
    durationMinutes: Number(row.duration_minutes),
    usedCount: Number(row.used_count),
    status: row.status,
    description: row.description,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function paperScope(scopeUser) {
  if (!scopeUser || scopeUser.roleCode === 'admin') return { sql: '1 = 1', params: [] };
  return { sql: 'p.owner_id = ?', params: [scopeUser.id] };
}

async function listPapers(filters, scopeUser, { limit, offset }) {
  const scope = paperScope(scopeUser);
  const where = [scope.sql, 'p.deleted_at IS NULL', "p.status <> 'deleted'"];
  const params = [...scope.params];
  if (filters.keyword) {
    where.push('(p.paper_name LIKE ? OR p.paper_no LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  if (filters.status) {
    where.push('p.status = ?');
    params.push(filters.status);
  }
  if (filters.examId) {
    where.push('EXISTS (SELECT 1 FROM ex_exam e WHERE e.paper_id = p.id AND e.id = ? AND e.deleted_at IS NULL)');
    params.push(filters.examId);
  }
  const sql = `SELECT ${PAPER_COLUMNS} ${PAPER_FROM} WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapPaper);
}

async function countPapers(filters, scopeUser) {
  const scope = paperScope(scopeUser);
  const where = [scope.sql, 'p.deleted_at IS NULL', "p.status <> 'deleted'"];
  const params = [...scope.params];
  if (filters.keyword) {
    where.push('(p.paper_name LIKE ? OR p.paper_no LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  if (filters.status) {
    where.push('p.status = ?');
    params.push(filters.status);
  }
  if (filters.examId) {
    where.push('EXISTS (SELECT 1 FROM ex_exam e WHERE e.paper_id = p.id AND e.id = ? AND e.deleted_at IS NULL)');
    params.push(filters.examId);
  }
  return Number(await db.queryValue(`SELECT COUNT(*) AS total FROM pp_paper p WHERE ${where.join(' AND ')}`, params));
}

async function findPaperById(id, conn = null) {
  const sql = `SELECT ${PAPER_COLUMNS} ${PAPER_FROM} WHERE p.id = ? AND p.deleted_at IS NULL LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [id]))[0] : await db.query(sql, [id]);
  return mapPaper(rows[0]);
}

async function createPaper(payload, conn) {
  const sql = `INSERT INTO pp_paper
    (paper_no, paper_name, owner_id, assembly_mode, total_score, question_count, duration_minutes,
     used_count, status, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`;
  const params = [
    payload.paperNo,
    payload.paperName,
    payload.ownerId,
    payload.assemblyMode || 'manual',
    payload.totalScore,
    payload.questionCount,
    payload.durationMinutes,
    payload.status || 'draft',
    payload.description || null,
    payload.createdBy,
  ];
  const [result] = await conn.query(sql, params);
  return Number(result.insertId);
}

async function updatePaper(id, payload, conn = null) {
  const sql = `UPDATE pp_paper SET paper_name = ?, description = ?, total_score = ?, duration_minutes = ?,
      question_count = ?, status = ?
    WHERE id = ? AND deleted_at IS NULL`;
  const params = [
    payload.paperName,
    payload.description || null,
    payload.totalScore,
    payload.durationMinutes,
    payload.questionCount,
    payload.status,
    id,
  ];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return result.affectedRows;
  }
  const result = await db.query(sql, params);
  return result.affectedRows;
}

async function updatePaperStatus(id, status) {
  const result = await db.query('UPDATE pp_paper SET status = ? WHERE id = ? AND deleted_at IS NULL', [status, id]);
  return result.affectedRows;
}

async function incrementUsedCount(id, conn = null) {
  // 已被引用过的试卷可继续用于新考试；仅未锁定的试卷自动置为 locked
  const sql = `UPDATE pp_paper SET used_count = used_count + 1,
      status = CASE WHEN status IN ('draft','published') THEN 'locked' ELSE status END
    WHERE id = ? AND deleted_at IS NULL AND status IN ('draft','published','locked')`;
  if (conn) {
    const [result] = await conn.query(sql, [id]);
    return result.affectedRows;
  }
  const result = await db.query(sql, [id]);
  return result.affectedRows;
}

async function softDeletePaper(id) {
  const result = await db.query(
    `UPDATE pp_paper SET deleted_at = UTC_TIMESTAMP(3), status = 'deleted' WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return result.affectedRows;
}

async function generatePaperNo() {
  const year = new Date().getUTCFullYear();
  const prefix = `PAPER-${year}-`;
  const total = Number(await db.queryValue('SELECT COUNT(*) AS total FROM pp_paper WHERE paper_no LIKE ?', [`${prefix}%`]));
  return `${prefix}${String(total + 1).padStart(4, '0')}`;
}

/* ------------------------------ 试卷题目 ------------------------------ */

function mapPaperQuestion(row) {
  if (!row) return null;
  const snapshot = parseJson(row.question_snapshot, {}) || {};
  return {
    paperQuestionId: Number(row.id),
    paperId: Number(row.paper_id),
    questionId: Number(row.question_id),
    questionNo: snapshot.questionNo || null,
    questionType: snapshot.questionType || row.question_type,
    difficulty: snapshot.difficulty === undefined ? null : Number(snapshot.difficulty),
    stem: snapshot.stem || '',
    options: snapshot.options || null,
    knowledgePointId: snapshot.knowledgePointId === undefined ? null : Number(snapshot.knowledgePointId),
    sectionNo: Number(row.section_no),
    orderNo: Number(row.order_no),
    score: toNum(row.score),
    questionSnapshot: snapshot,
  };
}

async function listPaperQuestions(paperId) {
  const sql = `SELECT pq.id, pq.paper_id, pq.question_id, pq.section_no, pq.order_no, pq.score,
      pq.question_snapshot, q.question_type
    FROM pp_paper_question pq JOIN qb_question q ON q.id = pq.question_id
    WHERE pq.paper_id = ? ORDER BY pq.order_no ASC, pq.id ASC`;
  return (await db.query(sql, [paperId])).map(mapPaperQuestion);
}

async function findPaperQuestion(paperId, paperQuestionId) {
  const sql = `SELECT pq.id, pq.paper_id, pq.question_id, pq.section_no, pq.order_no, pq.score,
      pq.question_snapshot, q.question_type
    FROM pp_paper_question pq JOIN qb_question q ON q.id = pq.question_id
    WHERE pq.paper_id = ? AND pq.id = ? LIMIT 1`;
  return mapPaperQuestion(await db.queryOne(sql, [paperId, paperQuestionId]));
}

async function insertPaperQuestion(paperId, item, conn) {
  const sql = `INSERT INTO pp_paper_question
    (paper_id, question_id, section_no, order_no, score, question_snapshot)
    VALUES (?, ?, ?, ?, ?, ?)`;
  const [result] = await conn.query(sql, [
    paperId,
    item.questionId,
    item.sectionNo || 1,
    item.orderNo,
    item.score,
    JSON.stringify(item.snapshot),
  ]);
  return Number(result.insertId);
}

async function deletePaperQuestion(paperId, paperQuestionId) {
  const result = await db.query('DELETE FROM pp_paper_question WHERE paper_id = ? AND id = ?', [paperId, paperQuestionId]);
  return result.affectedRows;
}

async function deleteAllPaperQuestions(paperId, conn) {
  await conn.query('DELETE FROM pp_paper_question WHERE paper_id = ?', [paperId]);
}

async function updatePaperQuestion(paperId, paperQuestionId, { score, orderNo, sectionNo }, conn = null) {
  const sql = `UPDATE pp_paper_question SET score = ?, order_no = ?, section_no = ?
    WHERE paper_id = ? AND id = ?`;
  const params = [score, orderNo, sectionNo, paperId, paperQuestionId];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return result.affectedRows;
  }
  const result = await db.query(sql, params);
  return result.affectedRows;
}

async function sumPaperScore(paperId, conn = null) {
  const sql = 'SELECT COALESCE(SUM(score), 0) AS total, COUNT(*) AS cnt FROM pp_paper_question WHERE paper_id = ?';
  const rows = conn ? (await conn.query(sql, [paperId]))[0] : await db.query(sql, [paperId]);
  return { sum: toNum(rows[0].total), count: Number(rows[0].cnt) };
}

async function countPaperExams(paperId) {
  const sql = `SELECT COUNT(*) AS total FROM ex_exam WHERE paper_id = ? AND deleted_at IS NULL AND status <> 'archived'`;
  return Number(await db.queryValue(sql, [paperId]));
}

async function findPaperByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const sql = `SELECT ${PAPER_COLUMNS} ${PAPER_FROM} WHERE p.id IN (${placeholders})`;
  return (await db.query(sql, ids)).map(mapPaper);
}

module.exports = {
  mapPaper,
  listPapers,
  countPapers,
  findPaperById,
  createPaper,
  updatePaper,
  updatePaperStatus,
  incrementUsedCount,
  softDeletePaper,
  generatePaperNo,
  mapPaperQuestion,
  listPaperQuestions,
  findPaperQuestion,
  insertPaperQuestion,
  deletePaperQuestion,
  deleteAllPaperQuestions,
  updatePaperQuestion,
  sumPaperScore,
  countPaperExams,
  findPaperByIds,
};