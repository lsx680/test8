'use strict';

/**
 * 题库、题目、版本、题目引用数据访问层
 * 数据权限在 SQL 层强制附加：教师仅本人题库或被授权题库，管理员不受限
 */
const db = require('../config/db');
const { parseJson } = require('../utils/mask');

/* ------------------------------ 题库 ------------------------------ */

const BANK_COLUMNS = `b.id, b.bank_code, b.bank_name, b.owner_id, b.description, b.visibility,
  b.question_count, b.status, b.created_at, u.real_name AS owner_name`;

function mapBank(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    bankCode: row.bank_code,
    bankName: row.bank_name,
    ownerId: Number(row.owner_id),
    ownerName: row.owner_name,
    description: row.description,
    visibility: row.visibility,
    questionCount: Number(row.question_count),
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function bankScope(scopeUser) {
  if (!scopeUser || scopeUser.roleCode === 'admin') return { sql: '1 = 1', params: [] };
  const sql = `(b.owner_id = ? OR EXISTS (
      SELECT 1 FROM qb_bank_authorization ba
      WHERE ba.bank_id = b.id AND ba.grantee_id = ?))`;
  return { sql, params: [scopeUser.id, scopeUser.id] };
}

async function listBanks(filters, scopeUser, { limit, offset }) {
  const scope = bankScope(scopeUser);
  const where = [scope.sql, "b.deleted_at IS NULL", "b.status <> 'deleted'"];
  const params = [...scope.params];
  if (filters.keyword) {
    where.push('(b.bank_name LIKE ? OR b.bank_code LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const sql = `SELECT ${BANK_COLUMNS} FROM qb_question_bank b
    JOIN sys_user u ON u.id = b.owner_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapBank);
}

async function countBanks(filters, scopeUser) {
  const scope = bankScope(scopeUser);
  const where = [scope.sql, 'b.deleted_at IS NULL', "b.status <> 'deleted'"];
  const params = [...scope.params];
  if (filters.keyword) {
    where.push('(b.bank_name LIKE ? OR b.bank_code LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const sql = `SELECT COUNT(*) AS total FROM qb_question_bank b WHERE ${where.join(' AND ')}`;
  return Number(await db.queryValue(sql, params));
}

async function findBankById(id, conn = null) {
  const sql = `SELECT ${BANK_COLUMNS} FROM qb_question_bank b
    JOIN sys_user u ON u.id = b.owner_id
    WHERE b.id = ? AND b.deleted_at IS NULL LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [id]))[0] : await db.query(sql, [id]);
  return mapBank(rows[0]);
}

async function findBankByName(ownerId, bankName) {
  const sql = `SELECT id FROM qb_question_bank
    WHERE owner_id = ? AND bank_name = ? AND deleted_at IS NULL LIMIT 1`;
  return db.queryOne(sql, [ownerId, bankName]);
}

async function createBank(payload, conn = null) {
  const sql = `INSERT INTO qb_question_bank
    (bank_code, bank_name, owner_id, description, visibility, question_count, status)
    VALUES (?, ?, ?, ?, ?, 0, 'active')`;
  const params = [payload.bankCode, payload.bankName, payload.ownerId, payload.description || null, payload.visibility || 'private'];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }
  const result = await db.query(sql, params);
  return Number(result.insertId);
}

async function updateBank(id, payload) {
  const sql = `UPDATE qb_question_bank SET bank_name = ?, bank_code = ?, description = ?, visibility = ?
    WHERE id = ? AND deleted_at IS NULL`;
  const result = await db.query(sql, [
    payload.bankName,
    payload.bankCode,
    payload.description || null,
    payload.visibility || 'private',
    id,
  ]);
  return result.affectedRows;
}

async function softDeleteBank(id) {
  const result = await db.query(
    `UPDATE qb_question_bank SET deleted_at = UTC_TIMESTAMP(3), status = 'deleted'
      WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return result.affectedRows;
}

async function refreshBankQuestionCount(bankId, conn = null) {
  const runner = conn || db;
  await runner.query(
    `UPDATE qb_question_bank SET question_count =
      (SELECT COUNT(*) FROM qb_question q WHERE q.bank_id = qb_question_bank.id AND q.deleted_at IS NULL)
      WHERE id = ?`,
    [bankId],
  );
}

async function findBankAuthorization(bankId, granteeId) {
  const sql = `SELECT id, bank_id, grantee_id, can_write FROM qb_bank_authorization
    WHERE bank_id = ? AND grantee_id = ? LIMIT 1`;
  const row = await db.queryOne(sql, [bankId, granteeId]);
  return row ? { id: Number(row.id), bankId: Number(row.bank_id), granteeId: Number(row.grantee_id), canWrite: Boolean(row.can_write) } : null;
}

async function upsertBankAuthorization(bankId, granteeId, canWrite, grantedBy) {
  const sql = `INSERT INTO qb_bank_authorization (bank_id, grantee_id, can_write, granted_by)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE can_write = VALUES(can_write), granted_by = VALUES(granted_by)`;
  await db.query(sql, [bankId, granteeId, canWrite ? 1 : 0, grantedBy]);
}

async function listBankAuthorizations(bankId) {
  const sql = `SELECT ba.id, ba.grantee_id, ba.can_write, ba.created_at, u.real_name, u.username
    FROM qb_bank_authorization ba JOIN sys_user u ON u.id = ba.grantee_id
    WHERE ba.bank_id = ? ORDER BY ba.created_at ASC`;
  return (await db.query(sql, [bankId])).map((row) => ({
    id: Number(row.id),
    granteeId: Number(row.grantee_id),
    granteeName: row.real_name,
    granteeUsername: row.username,
    canWrite: Boolean(row.can_write),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

/** 题库是否被试卷引用（删除保护） */
async function countBankPaperReferences(bankId) {
  const sql = `SELECT COUNT(DISTINCT pq.paper_id) AS total
    FROM qb_question q JOIN pp_paper_question pq ON pq.question_id = q.id
    JOIN pp_paper p ON p.id = pq.paper_id AND p.deleted_at IS NULL AND p.status <> 'archived'
    WHERE q.bank_id = ? AND q.deleted_at IS NULL`;
  return Number(await db.queryValue(sql, [bankId]));
}

/* ------------------------------ 题目 ------------------------------ */

const QUESTION_COLUMNS = `q.id, q.question_no, q.bank_id, b.bank_name, q.knowledge_point_id,
  kp.kp_name AS knowledge_point_name, q.question_type, q.difficulty, q.stem, q.options,
  q.correct_answer, q.scoring_points, q.analysis, q.default_score, q.current_version,
  q.reference_count, q.status, q.created_by, u.real_name AS created_by_name, q.created_at, q.updated_at`;

const QUESTION_FROM = `FROM qb_question q
  JOIN qb_question_bank b ON b.id = q.bank_id
  LEFT JOIN kb_knowledge_point kp ON kp.id = q.knowledge_point_id
  LEFT JOIN sys_user u ON u.id = q.created_by`;

function mapQuestion(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    questionNo: row.question_no,
    bankId: Number(row.bank_id),
    bankName: row.bank_name,
    knowledgePointId: row.knowledge_point_id === null ? null : Number(row.knowledge_point_id),
    knowledgePointName: row.knowledge_point_name || null,
    questionType: row.question_type,
    difficulty: Number(row.difficulty),
    stem: row.stem,
    options: parseJson(row.options, null),
    correctAnswer: parseJson(row.correct_answer, []),
    scoringPoints: parseJson(row.scoring_points, null),
    analysis: row.analysis,
    defaultScore: Number(row.default_score),
    currentVersion: Number(row.current_version),
    referenceCount: Number(row.reference_count),
    status: row.status,
    createdBy: Number(row.created_by),
    createdByName: row.created_by_name,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/** 教师题目可见范围：本人题库或已授权题库 */
function questionScope(scopeUser) {
  if (!scopeUser || scopeUser.roleCode === 'admin') return { sql: '1 = 1', params: [] };
  const sql = `(b.owner_id = ? OR EXISTS (
      SELECT 1 FROM qb_bank_authorization ba WHERE ba.bank_id = b.id AND ba.grantee_id = ?))`;
  return { sql, params: [scopeUser.id, scopeUser.id] };
}

function buildQuestionFilter(filters) {
  const where = ['q.deleted_at IS NULL'];
  const params = [];
  if (filters.keyword) {
    where.push('q.stem LIKE ?');
    params.push(`%${filters.keyword}%`);
  }
  if (filters.bankId) {
    where.push('q.bank_id = ?');
    params.push(filters.bankId);
  }
  if (filters.questionType) {
    where.push('q.question_type = ?');
    params.push(filters.questionType);
  }
  if (filters.difficulty) {
    where.push('q.difficulty = ?');
    params.push(filters.difficulty);
  }
  if (filters.knowledgePointId) {
    where.push('q.knowledge_point_id = ?');
    params.push(filters.knowledgePointId);
  }
  if (filters.createdBy) {
    where.push('q.created_by = ?');
    params.push(filters.createdBy);
  }
  if (filters.status) {
    where.push('q.status = ?');
    params.push(filters.status);
  }
  return { where, params };
}

async function listQuestions(filters, scopeUser, { limit, offset }) {
  const scope = questionScope(scopeUser);
  const { where, params } = buildQuestionFilter(filters);
  const sql = `SELECT ${QUESTION_COLUMNS} ${QUESTION_FROM}
    WHERE ${scope.sql} AND ${where.join(' AND ')}
    ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...scope.params, ...params, limit, offset])).map(mapQuestion);
}

async function countQuestions(filters, scopeUser) {
  const scope = questionScope(scopeUser);
  const { where, params } = buildQuestionFilter(filters);
  const sql = `SELECT COUNT(*) AS total ${QUESTION_FROM} WHERE ${scope.sql} AND ${where.join(' AND ')}`;
  return Number(await db.queryValue(sql, [...scope.params, ...params]));
}

async function findQuestionById(id, conn = null) {
  const sql = `SELECT ${QUESTION_COLUMNS} ${QUESTION_FROM} WHERE q.id = ? AND q.deleted_at IS NULL LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [id]))[0] : await db.query(sql, [id]);
  return mapQuestion(rows[0]);
}

async function findQuestionsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const sql = `SELECT ${QUESTION_COLUMNS} ${QUESTION_FROM}
    WHERE q.id IN (${placeholders}) AND q.deleted_at IS NULL ORDER BY q.id ASC`;
  return (await db.query(sql, ids)).map(mapQuestion);
}

async function createQuestion(payload, conn = null) {
  const sql = `INSERT INTO qb_question
    (question_no, bank_id, knowledge_point_id, question_type, difficulty, stem, options,
     correct_answer, scoring_points, analysis, default_score, current_version, reference_count, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`;
  const params = [
    payload.questionNo,
    payload.bankId,
    payload.knowledgePointId || null,
    payload.questionType,
    payload.difficulty || 3,
    payload.stem,
    payload.options ? JSON.stringify(payload.options) : null,
    JSON.stringify(payload.correctAnswer || []),
    payload.scoringPoints ? JSON.stringify(payload.scoringPoints) : null,
    payload.analysis || null,
    payload.defaultScore,
    payload.status || 'published',
    payload.createdBy,
  ];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }
  const result = await db.query(sql, params);
  return Number(result.insertId);
}

async function updateQuestion(id, payload, conn = null) {
  const sql = `UPDATE qb_question SET bank_id = ?, knowledge_point_id = ?, question_type = ?,
      difficulty = ?, stem = ?, options = ?, correct_answer = ?, scoring_points = ?, analysis = ?,
      default_score = ?, current_version = current_version + 1, status = ?
    WHERE id = ? AND deleted_at IS NULL AND current_version = ?`;
  const params = [
    payload.bankId,
    payload.knowledgePointId || null,
    payload.questionType,
    payload.difficulty || 3,
    payload.stem,
    payload.options ? JSON.stringify(payload.options) : null,
    JSON.stringify(payload.correctAnswer || []),
    payload.scoringPoints ? JSON.stringify(payload.scoringPoints) : null,
    payload.analysis || null,
    payload.defaultScore,
    payload.status || 'published',
    id,
    payload.version,
  ];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return result.affectedRows;
  }
  const result = await db.query(sql, params);
  return result.affectedRows;
}

async function softDeleteQuestion(id) {
  const sql = `UPDATE qb_question SET deleted_at = UTC_TIMESTAMP(3), status = 'archived'
    WHERE id = ? AND deleted_at IS NULL`;
  const result = await db.query(sql, [id]);
  return result.affectedRows;
}

async function updateCorrectAnswer(id, correctAnswer, conn = null) {
  const sql = `UPDATE qb_question SET correct_answer = ?, current_version = current_version + 1
    WHERE id = ? AND deleted_at IS NULL`;
  if (conn) {
    await conn.query(sql, [JSON.stringify(correctAnswer), id]);
    return;
  }
  await db.query(sql, [JSON.stringify(correctAnswer), id]);
}

async function incrementReferenceCount(questionId, delta, conn = null) {
  const sql = 'UPDATE qb_question SET reference_count = GREATEST(0, reference_count + ?) WHERE id = ?';
  if (conn) {
    await conn.query(sql, [delta, questionId]);
    return;
  }
  await db.query(sql, [delta, questionId]);
}

async function refreshReferenceCount(questionId) {
  await db.query(
    `UPDATE qb_question SET reference_count =
      (SELECT COUNT(*) FROM pp_paper_question pq JOIN pp_paper p ON p.id = pq.paper_id
       WHERE pq.question_id = qb_question.id AND p.deleted_at IS NULL AND p.status <> 'archived')
      WHERE id = ?`,
    [questionId],
  );
}

async function generateQuestionNo() {
  const year = new Date().getUTCFullYear();
  const prefix = `Q-${year}-`;
  const sql = 'SELECT COUNT(*) AS total FROM qb_question WHERE question_no LIKE ?';
  const total = Number(await db.queryValue(sql, [`${prefix}%`]));
  return `${prefix}${String(total + 1).padStart(6, '0')}`;
}

async function listVersions(questionId) {
  const sql = `SELECT v.id, v.question_id, v.version_no, v.snapshot, v.change_type,
      v.change_summary, v.changed_by, u.real_name AS changed_by_name, v.created_at
    FROM qb_question_version v LEFT JOIN sys_user u ON u.id = v.changed_by
    WHERE v.question_id = ? ORDER BY v.version_no DESC`;
  return (await db.query(sql, [questionId])).map((row) => ({
    id: Number(row.id),
    questionId: Number(row.question_id),
    versionNo: Number(row.version_no),
    changeType: row.change_type,
    changeSummary: row.change_summary,
    changedBy: Number(row.changed_by),
    changedByName: row.changed_by_name,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    snapshot: parseJson(row.snapshot, {}),
  }));
}

async function addVersion(questionId, versionNo, snapshot, changeType, changeSummary, changedBy, conn = null) {
  const sql = `INSERT INTO qb_question_version
    (question_id, version_no, snapshot, change_type, change_summary, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)`;
  const params = [questionId, versionNo, JSON.stringify(snapshot), changeType, changeSummary || null, changedBy];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }
  const result = await db.query(sql, params);
  return Number(result.insertId);
}

/** 题目引用清单：未归档试卷 + 已发布/进行中考试 */
async function findQuestionReferences(questionId) {
  const paperSql = `SELECT DISTINCT p.id AS paper_id, p.paper_name, p.status
    FROM pp_paper_question pq JOIN pp_paper p ON p.id = pq.paper_id
    WHERE pq.question_id = ? AND p.deleted_at IS NULL AND p.status <> 'archived'`;
  const examSql = `SELECT DISTINCT e.id AS exam_id, e.exam_name, e.status
    FROM pp_paper_question pq
    JOIN pp_paper p ON p.id = pq.paper_id AND p.deleted_at IS NULL
    JOIN ex_exam e ON e.paper_id = p.id
    WHERE pq.question_id = ? AND e.deleted_at IS NULL
      AND e.status IN ('published', 'ongoing')`;
  const [papers, exams] = await Promise.all([db.query(paperSql, [questionId]), db.query(examSql, [questionId])]);
  return {
    questionId: Number(questionId),
    papers: papers.map((row) => ({ paperId: Number(row.paper_id), paperName: row.paper_name, status: row.status })),
    exams: exams.map((row) => ({ examId: Number(row.exam_id), examName: row.exam_name, status: row.status })),
  };
}

/** 导出（不带分页，上限由 service 控制） */
async function listQuestionsForExport(filters, scopeUser, maxRows = 10000) {
  const scope = questionScope(scopeUser);
  const { where, params } = buildQuestionFilter(filters);
  const sql = `SELECT ${QUESTION_COLUMNS} ${QUESTION_FROM}
    WHERE ${scope.sql} AND ${where.join(' AND ')}
    ORDER BY q.id ASC LIMIT ?`;
  return (await db.query(sql, [...scope.params, ...params, maxRows])).map(mapQuestion);
}

/** 随机组卷候选池（按条件筛选，由 service 二次抽样） */
async function findRandomCandidates({ bankIds, knowledgePointIds, questionType, difficulties, scopeUser }) {
  const scope = questionScope(scopeUser);
  const where = [scope.sql, 'q.deleted_at IS NULL', "q.status = 'published'"];
  const params = [...scope.params];
  if (bankIds && bankIds.length > 0) {
    where.push(`q.bank_id IN (${bankIds.map(() => '?').join(',')})`);
    params.push(...bankIds);
  }
  if (knowledgePointIds && knowledgePointIds.length > 0) {
    where.push(`q.knowledge_point_id IN (${knowledgePointIds.map(() => '?').join(',')})`);
    params.push(...knowledgePointIds);
  }
  if (questionType) {
    where.push('q.question_type = ?');
    params.push(questionType);
  }
  if (difficulties && difficulties.length > 0) {
    where.push(`q.difficulty IN (${difficulties.map(() => '?').join(',')})`);
    params.push(...difficulties);
  }
  const sql = `SELECT ${QUESTION_COLUMNS} ${QUESTION_FROM}
    WHERE ${where.join(' AND ')} ORDER BY q.difficulty ASC, q.id ASC`;
  return (await db.query(sql, params)).map(mapQuestion);
}

/** 按题库归属校验题目可用性（供组卷使用） */
async function findBankOwnerAndAuth(bankId, userId) {
  const sql = `SELECT b.id, b.owner_id,
      (SELECT can_write FROM qb_bank_authorization WHERE bank_id = b.id AND grantee_id = ?) AS can_write
    FROM qb_question_bank b WHERE b.id = ? AND b.deleted_at IS NULL LIMIT 1`;
  const row = await db.queryOne(sql, [userId, bankId]);
  if (!row) return null;
  return {
    bankId: Number(row.id),
    ownerId: Number(row.owner_id),
    canWrite: row.can_write === null ? null : Boolean(row.can_write),
  };
}

module.exports = {
  mapBank,
  listBanks,
  countBanks,
  findBankById,
  findBankByName,
  createBank,
  updateBank,
  softDeleteBank,
  refreshBankQuestionCount,
  findBankAuthorization,
  upsertBankAuthorization,
  listBankAuthorizations,
  countBankPaperReferences,
  mapQuestion,
  listQuestions,
  countQuestions,
  findQuestionById,
  findQuestionsByIds,
  createQuestion,
  updateQuestion,
  softDeleteQuestion,
  updateCorrectAnswer,
  incrementReferenceCount,
  refreshReferenceCount,
  generateQuestionNo,
  listVersions,
  addVersion,
  findQuestionReferences,
  listQuestionsForExport,
  findRandomCandidates,
  findBankOwnerAndAuth,
};