'use strict';

/** 答卷、答卷题目、防作弊事件数据访问层 */
const db = require('../config/db');
const { parseJson, toNum, toBool } = require('../utils/mask');

const ATTEMPT_COLUMNS = `a.id, a.attempt_no, a.exam_id, a.task_id, a.student_id, a.paper_id,
  a.attempt_seq, a.status, a.started_at, a.deadline_at, a.submitted_at, a.submit_type,
  a.objective_score, a.subjective_score, a.total_score, a.is_passed, a.grading_status,
  a.is_abnormal, a.abnormal_reason, a.device_key, a.ip, a.graded_at, a.created_at, a.updated_at,
  e.exam_name, e.pass_score, e.auto_submit_on_timeout, e.score_status, e.owner_id AS exam_owner_id,
  u.username AS student_no, u.real_name AS student_name, c.class_name`;

const ATTEMPT_FROM = `FROM ex_exam_attempt a
  JOIN ex_exam e ON e.id = a.exam_id
  JOIN sys_user u ON u.id = a.student_id
  LEFT JOIN sys_class c ON c.id = u.class_id`;

function mapAttempt(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    attemptNo: row.attempt_no,
    examId: Number(row.exam_id),
    taskId: row.task_id === null ? null : Number(row.task_id),
    studentId: Number(row.student_id),
    paperId: Number(row.paper_id),
    attemptSeq: Number(row.attempt_seq),
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    submitType: row.submit_type,
    objectiveScore: toNum(row.objective_score),
    subjectiveScore: toNum(row.subjective_score),
    totalScore: toNum(row.total_score),
    isPassed: row.is_passed === null ? null : Boolean(row.is_passed),
    gradingStatus: row.grading_status,
    isAbnormal: Boolean(row.is_abnormal),
    abnormalReason: row.abnormal_reason,
    deviceKey: row.device_key,
    ip: row.ip,
    gradedAt: row.graded_at ? new Date(row.graded_at).toISOString() : null,
    examName: row.exam_name,
    passScore: toNum(row.pass_score),
    autoSubmitOnTimeout: Boolean(row.auto_submit_on_timeout),
    scoreStatus: row.score_status,
    examOwnerId: Number(row.exam_owner_id),
    studentNo: row.student_no,
    studentName: row.student_name,
    className: row.class_name || null,
  };
}

async function findById(id, { conn = null } = {}) {
  const sql = `SELECT ${ATTEMPT_COLUMNS} ${ATTEMPT_FROM} WHERE a.id = ? LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [id]))[0] : await db.query(sql, [id]);
  return mapAttempt(rows[0]);
}

async function findOngoing(examId, studentId, conn = null) {
  const sql = `SELECT ${ATTEMPT_COLUMNS} ${ATTEMPT_FROM}
    WHERE a.exam_id = ? AND a.student_id = ? AND a.status = 'ongoing' LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [examId, studentId]))[0] : await db.query(sql, [examId, studentId]);
  return mapAttempt(rows[0]);
}

async function findMaxSeq(examId, studentId, conn) {
  const sql = 'SELECT COALESCE(MAX(attempt_seq), 0) AS max_seq FROM ex_exam_attempt WHERE exam_id = ? AND student_id = ?';
  const rows = (await conn.query(sql, [examId, studentId]))[0];
  return Number(rows[0].max_seq);
}

async function latestForStudentExam(examId, studentId) {
  const sql = `SELECT ${ATTEMPT_COLUMNS} ${ATTEMPT_FROM}
    WHERE a.exam_id = ? AND a.student_id = ? ORDER BY a.attempt_seq DESC LIMIT 1`;
  return mapAttempt(await db.queryOne(sql, [examId, studentId]));
}

async function createAttempt(payload, conn) {
  const sql = `INSERT INTO ex_exam_attempt
    (attempt_no, exam_id, task_id, student_id, paper_id, attempt_seq, status, started_at, deadline_at,
     grading_status, device_key, ip)
    VALUES (?, ?, ?, ?, ?, ?, 'ongoing', UTC_TIMESTAMP(3),
      LEAST(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), ?), 'pending', ?, ?)`;
  const params = [
    payload.attemptNo,
    payload.examId,
    payload.taskId || null,
    payload.studentId,
    payload.paperId,
    payload.attemptSeq,
    payload.durationMinutes,
    payload.examEndTime,
    payload.deviceKey || null,
    payload.ip || null,
  ];
  const [result] = await conn.query(sql, params);
  return Number(result.insertId);
}

async function remainingSeconds(attemptId) {
  const sql = `SELECT a.id, a.status, a.deadline_at, a.start_time_unused,
      GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), a.deadline_at)) AS remaining_seconds,
      (UTC_TIMESTAMP(3) > a.deadline_at) AS is_expired
    FROM ex_exam_attempt a WHERE a.id = ?`;
  // start_time_unused 不存在，仅保留必要列（避免 SELECT *）
  const safeSql = `SELECT a.id, a.status, a.deadline_at,
      GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), a.deadline_at)) AS remaining_seconds,
      (UTC_TIMESTAMP(3) > a.deadline_at) AS is_expired
    FROM ex_exam_attempt a WHERE a.id = ?`;
  const row = await db.queryOne(safeSql, [attemptId]);
  if (!row) return null;
  return {
    attemptId: Number(row.id),
    status: row.status,
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    remainingSeconds: Number(row.remaining_seconds),
    isExpired: Boolean(row.is_expired),
  };
}

/* ------------------------------ 答卷题目 ------------------------------ */

const AQ_COLUMNS = `id, attempt_id, paper_question_id, question_id, question_type, order_no,
  full_score, question_snapshot, student_answer, answer_version, answer_saved_at,
  auto_score, manual_score, final_score, is_correct, grade_status, grader_id, graded_at, grader_comment`;

function mapAttemptQuestion(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    attemptId: Number(row.attempt_id),
    paperQuestionId: Number(row.paper_question_id),
    questionId: Number(row.question_id),
    questionType: row.question_type,
    orderNo: Number(row.order_no),
    fullScore: toNum(row.full_score),
    snapshot: parseJson(row.question_snapshot, {}),
    studentAnswer: parseJson(row.student_answer, null),
    answerVersion: Number(row.answer_version),
    answerSavedAt: row.answer_saved_at ? new Date(row.answer_saved_at).toISOString() : null,
    autoScore: toNum(row.auto_score),
    manualScore: row.manual_score === null ? null : toNum(row.manual_score),
    finalScore: toNum(row.final_score),
    isCorrect: row.is_correct === null ? null : Boolean(row.is_correct),
    gradeStatus: row.grade_status,
    graderId: row.grader_id === null ? null : Number(row.grader_id),
    gradedAt: row.graded_at ? new Date(row.graded_at).toISOString() : null,
    graderComment: row.grader_comment,
  };
}

async function listAttemptQuestions(attemptId, conn = null) {
  const sql = `SELECT ${AQ_COLUMNS} FROM ex_attempt_question WHERE attempt_id = ? ORDER BY order_no ASC`;
  const rows = conn ? (await conn.query(sql, [attemptId]))[0] : await db.query(sql, [attemptId]);
  return rows.map(mapAttemptQuestion);
}

async function findAttemptQuestion(attemptId, questionId) {
  const sql = `SELECT ${AQ_COLUMNS} FROM ex_attempt_question WHERE attempt_id = ? AND question_id = ? LIMIT 1`;
  return mapAttemptQuestion(await db.queryOne(sql, [attemptId, questionId]));
}

async function findAttemptQuestionById(id, conn = null) {
  const sql = `SELECT ${AQ_COLUMNS} FROM ex_attempt_question WHERE id = ? LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [id]))[0] : await db.query(sql, [id]);
  return mapAttemptQuestion(rows[0]);
}

async function insertAttemptQuestions(attemptId, items, conn) {
  if (items.length === 0) return 0;
  const sql = `INSERT INTO ex_attempt_question
    (attempt_id, paper_question_id, question_id, question_type, order_no, full_score, question_snapshot)
    VALUES ?`;
  const values = items.map((item) => [
    attemptId,
    item.paperQuestionId,
    item.questionId,
    item.questionType,
    item.orderNo,
    item.fullScore,
    JSON.stringify(item.snapshot),
  ]);
  const [result] = await conn.query(sql, [values]);
  return result.affectedRows;
}

/**
 * 答案 UPSERT + answerVersion 乐观锁
 * 只有 status='ongoing' 的答卷可写入；返回 affectedRows=0 表示版本冲突或状态不符
 */
async function saveAnswer(attemptId, questionId, answerJson, expectedVersion, conn = null) {
  const params = [answerJson, attemptId, questionId];
  let versionCondition = '';
  if (expectedVersion !== undefined && expectedVersion !== null) {
    versionCondition = ' AND answer_version = ?';
    params.push(expectedVersion);
  }
  const sql = `UPDATE ex_attempt_question
    SET student_answer = ?, answer_version = answer_version + 1, answer_saved_at = UTC_TIMESTAMP(3)
    WHERE attempt_id = ? AND question_id = ?${versionCondition}`;
  const runner = conn || db;
  const result = await runner.query(sql, params);
  return result.affectedRows === undefined ? result[0].affectedRows : result.affectedRows;
}

async function countAnswered(attemptId) {
  const sql = 'SELECT COUNT(*) AS total FROM ex_attempt_question WHERE attempt_id = ? AND student_answer IS NOT NULL';
  return Number(await db.queryValue(sql, [attemptId]));
}

async function countQuestions(attemptId) {
  return Number(await db.queryValue('SELECT COUNT(*) AS total FROM ex_attempt_question WHERE attempt_id = ?', [attemptId]));
}

/** 交卷条件更新：只有 ongoing 命中，影响行数即"是否首次交卷" */
async function conditionalSubmit(attemptId, submitType, conn) {
  const sql = `UPDATE ex_exam_attempt
    SET status = 'submitted', submitted_at = UTC_TIMESTAMP(3), submit_type = ?
    WHERE id = ? AND status = 'ongoing'`;
  const [result] = await conn.query(sql, [submitType, attemptId]);
  return result.affectedRows;
}

async function updateAttemptTotals(attemptId, { objectiveScore, subjectiveScore, totalScore, isPassed, gradingStatus, status, conn }) {
  const sql = `UPDATE ex_exam_attempt
    SET objective_score = ?, subjective_score = ?, total_score = ?, is_passed = ?,
        grading_status = ?, status = COALESCE(?, status), graded_at = UTC_TIMESTAMP(3)
    WHERE id = ?`;
  const params = [objectiveScore, subjectiveScore, totalScore, isPassed, gradingStatus, status || null, attemptId];
  if (conn) {
    await conn.query(sql, params);
    return;
  }
  await db.query(sql, params);
}

async function markAbnormal(attemptId, reason) {
  const sql = 'UPDATE ex_exam_attempt SET is_abnormal = 1, abnormal_reason = ? WHERE id = ?';
  await db.query(sql, [reason, attemptId]);
}

async function expireAttempt(attemptId) {
  const sql = `UPDATE ex_exam_attempt SET status = 'expired' WHERE id = ? AND status = 'ongoing'`;
  await db.query(sql, [attemptId]);
}

/* ------------------------------ 防作弊事件 ------------------------------ */

async function addAntiCheatEvent({ attemptId, examId, studentId, eventType, detail, ip, userAgent }, conn = null) {
  const sql = `INSERT INTO ex_anti_cheat_event
    (attempt_id, exam_id, student_id, event_type, cumulative_count, event_time, detail, ip, user_agent)
    VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3), ?, ?, ?)`;
  const params = [attemptId, examId, studentId, eventType, detail ? JSON.stringify(detail) : null, ip || null, userAgent ? String(userAgent).slice(0, 255) : null];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }
  const result = await db.query(sql, params);
  return Number(result.insertId);
}

async function cumulativeEventCount(attemptId, eventType) {
  const sql = 'SELECT COUNT(*) AS total FROM ex_anti_cheat_event WHERE attempt_id = ? AND event_type = ?';
  return Number(await db.queryValue(sql, [attemptId, eventType]));
}

async function totalEventCount(attemptId) {
  return Number(await db.queryValue('SELECT COUNT(*) AS total FROM ex_anti_cheat_event WHERE attempt_id = ?', [attemptId]));
}

/** 重判 / 阅卷：更新单题客观分 */
async function updateObjectiveScore(aqId, { autoScore, finalScore, isCorrect, gradeStatus }, conn) {
  const sql = `UPDATE ex_attempt_question SET auto_score = ?, final_score = ?, is_correct = ?, grade_status = ?
    WHERE id = ?`;
  await conn.query(sql, [autoScore, finalScore, isCorrect === null ? null : (isCorrect ? 1 : 0), gradeStatus, aqId]);
}

/** 阅卷：更新单题人工分 */
async function updateManualScore(aqId, { manualScore, finalScore, gradeStatus, graderId, comment }, conn) {
  const sql = `UPDATE ex_attempt_question SET manual_score = ?, final_score = ?, grade_status = ?,
      grader_id = ?, graded_at = UTC_TIMESTAMP(3), grader_comment = ?
    WHERE id = ?`;
  await conn.query(sql, [manualScore, finalScore, gradeStatus, graderId, comment || null, aqId]);
}

/** 重判时更新答卷题目快照中的标准答案（历史快照显式变更） */
async function updateQuestionSnapshot(aqId, snapshot, conn) {
  await conn.query('UPDATE ex_attempt_question SET question_snapshot = ? WHERE id = ?', [JSON.stringify(snapshot), aqId]);
}

async function resetObjectiveScores(attemptId, conn) {
  const sql = `UPDATE ex_attempt_question SET auto_score = 0, final_score = 0, is_correct = NULL
    WHERE attempt_id = ? AND question_type IN ('single','multiple','judge','fill')`;
  await conn.query(sql, [attemptId]);
}

/** 主观题最终分始终等于人工分（未评分按 0），判分重放不得覆盖人工分 */
async function syncSubjectiveFinal(attemptId, conn) {
  const sql = `UPDATE ex_attempt_question SET final_score = COALESCE(manual_score, 0)
    WHERE attempt_id = ? AND question_type = 'short'`;
  await conn.query(sql, [attemptId]);
}

/** 超时扫描：进行中且已过截止时间的答卷 */
async function listExpiredOngoing(limit = 50) {
  const sql = `SELECT a.id, a.exam_id, a.student_id FROM ex_exam_attempt a
    WHERE a.status = 'ongoing' AND a.deadline_at < UTC_TIMESTAMP(3)
    ORDER BY a.deadline_at ASC LIMIT ?`;
  return (await db.query(sql, [limit])).map((row) => ({
    id: Number(row.id),
    examId: Number(row.exam_id),
    studentId: Number(row.student_id),
  }));
}

async function sumScores(attemptId, conn = null) {
  const sql = `SELECT
      COALESCE(SUM(CASE WHEN question_type IN ('single','multiple','judge','fill') THEN final_score ELSE 0 END), 0) AS objective,
      COALESCE(SUM(CASE WHEN question_type = 'short' THEN COALESCE(manual_score, 0) ELSE 0 END), 0) AS subjective,
      COALESCE(SUM(final_score), 0) AS total
    FROM ex_attempt_question WHERE attempt_id = ?`;
  const rows = conn ? (await conn.query(sql, [attemptId]))[0] : await db.query(sql, [attemptId]);
  return {
    objective: toNum(rows[0].objective),
    subjective: toNum(rows[0].subjective),
    total: toNum(rows[0].total),
  };
}

/** 受影响答卷（重判）：按题目 + 考试范围筛选 */
async function listAttemptsAffectedByQuestion(questionId, examId = null, conn = null) {
  const params = [questionId];
  let sql = `SELECT DISTINCT a.id, a.exam_id, a.student_id, a.status
    FROM ex_attempt_question q JOIN ex_exam_attempt a ON a.id = q.attempt_id
    WHERE q.question_id = ? AND a.status IN ('submitted','grading','graded','reviewed')`;
  if (examId) {
    sql += ' AND a.exam_id = ?';
    params.push(examId);
  }
  sql += ' ORDER BY a.id ASC';
  const rows = conn ? (await conn.query(sql, params))[0] : await db.query(sql, params);
  return rows.map((row) => ({ id: Number(row.id), examId: Number(row.exam_id), studentId: Number(row.student_id), status: row.status }));
}

async function listAttemptsForExam(examId) {
  const sql = `SELECT ${ATTEMPT_COLUMNS} ${ATTEMPT_FROM}
    WHERE a.exam_id = ? AND a.status IN ('submitted','grading','graded','reviewed') ORDER BY a.id ASC`;
  return (await db.query(sql, [examId])).map(mapAttempt);
}

module.exports = {
  mapAttempt,
  findById,
  findOngoing,
  findMaxSeq,
  latestForStudentExam,
  createAttempt,
  remainingSeconds,
  mapAttemptQuestion,
  listAttemptQuestions,
  findAttemptQuestion,
  findAttemptQuestionById,
  insertAttemptQuestions,
  saveAnswer,
  countAnswered,
  countQuestions,
  conditionalSubmit,
  updateAttemptTotals,
  markAbnormal,
  expireAttempt,
  addAntiCheatEvent,
  cumulativeEventCount,
  totalEventCount,
  updateObjectiveScore,
  updateManualScore,
  updateQuestionSnapshot,
  resetObjectiveScores,
  syncSubjectiveFinal,
  listExpiredOngoing,
  sumScores,
  listAttemptsAffectedByQuestion,
  listAttemptsForExam,
};