'use strict';

/** 考试、参考范围、考试任务、补考授权、防作弊事件数据访问层 */
const db = require('../config/db');
const { parseJson, toNum, toBool } = require('../utils/mask');

const EXAM_COLUMNS = `e.id, e.exam_no, e.exam_name, e.paper_id, e.owner_id, e.start_time, e.end_time,
  e.duration_minutes, e.pass_score, e.max_attempts, e.shuffle_questions, e.anti_cheat_enabled,
  e.anti_cheat_threshold, e.auto_submit_on_timeout, e.score_status, e.score_published_at,
  e.published_by, e.status, e.description, e.created_at, e.updated_at,
  p.paper_name, u.real_name AS owner_name`;

const EXAM_FROM = `FROM ex_exam e
  JOIN pp_paper p ON p.id = e.paper_id
  JOIN sys_user u ON u.id = e.owner_id`;

function mapExam(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    examNo: row.exam_no,
    examName: row.exam_name,
    paperId: Number(row.paper_id),
    paperName: row.paper_name,
    ownerId: Number(row.owner_id),
    ownerName: row.owner_name,
    startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
    endTime: row.end_time ? new Date(row.end_time).toISOString() : null,
    durationMinutes: Number(row.duration_minutes),
    passScore: toNum(row.pass_score),
    maxAttempts: Number(row.max_attempts),
    shuffleQuestions: Boolean(row.shuffle_questions),
    antiCheatEnabled: Boolean(row.anti_cheat_enabled),
    antiCheatThreshold: Number(row.anti_cheat_threshold),
    autoSubmitOnTimeout: Boolean(row.auto_submit_on_timeout),
    scoreStatus: row.score_status,
    scorePublishedAt: row.score_published_at ? new Date(row.score_published_at).toISOString() : null,
    status: row.status,
    description: row.description,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function examScope(scopeUser) {
  if (!scopeUser || scopeUser.roleCode === 'admin') return { sql: '1 = 1', params: [] };
  return { sql: 'e.owner_id = ?', params: [scopeUser.id] };
}

async function listExams(filters, scopeUser, { limit, offset }) {
  const scope = examScope(scopeUser);
  const where = [scope.sql, 'e.deleted_at IS NULL'];
  const params = [...scope.params];
  if (filters.keyword) {
    where.push('(e.exam_name LIKE ? OR e.exam_no LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  if (filters.status) {
    where.push('e.status = ?');
    params.push(filters.status);
  }
  if (filters.scoreStatus) {
    where.push('e.score_status = ?');
    params.push(filters.scoreStatus);
  }
  const sql = `SELECT ${EXAM_COLUMNS} ${EXAM_FROM} WHERE ${where.join(' AND ')}
    ORDER BY e.start_time DESC, e.id DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapExam);
}

async function countExams(filters, scopeUser) {
  const scope = examScope(scopeUser);
  const where = [scope.sql, 'e.deleted_at IS NULL'];
  const params = [...scope.params];
  if (filters.keyword) {
    where.push('(e.exam_name LIKE ? OR e.exam_no LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  if (filters.status) {
    where.push('e.status = ?');
    params.push(filters.status);
  }
  if (filters.scoreStatus) {
    where.push('e.score_status = ?');
    params.push(filters.scoreStatus);
  }
  return Number(await db.queryValue(`SELECT COUNT(*) AS total FROM ex_exam e WHERE ${where.join(' AND ')}`, params));
}

async function findExamById(id, conn = null) {
  const sql = `SELECT ${EXAM_COLUMNS} ${EXAM_FROM} WHERE e.id = ? AND e.deleted_at IS NULL LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [id]))[0] : await db.query(sql, [id]);
  return mapExam(rows[0]);
}

async function generateExamNo() {
  const year = new Date().getUTCFullYear();
  const prefix = `EXAM-${year}-`;
  const total = Number(await db.queryValue('SELECT COUNT(*) AS total FROM ex_exam WHERE exam_no LIKE ?', [`${prefix}%`]));
  return `${prefix}${String(total + 1).padStart(4, '0')}`;
}

async function createExam(payload, conn) {
  const sql = `INSERT INTO ex_exam
    (exam_no, exam_name, paper_id, owner_id, start_time, end_time, duration_minutes, pass_score,
     max_attempts, shuffle_questions, anti_cheat_enabled, anti_cheat_threshold, auto_submit_on_timeout,
     score_status, status, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpublished', 'draft', ?, ?)`;
  const params = [
    payload.examNo,
    payload.examName,
    payload.paperId,
    payload.ownerId,
    payload.startTime,
    payload.endTime,
    payload.durationMinutes,
    payload.passScore,
    payload.maxAttempts,
    payload.shuffleQuestions ? 1 : 0,
    payload.antiCheatEnabled ? 1 : 0,
    payload.antiCheatThreshold,
    payload.autoSubmitOnTimeout ? 1 : 0,
    payload.description || null,
    payload.createdBy,
  ];
  const [result] = await conn.query(sql, params);
  return Number(result.insertId);
}

async function updateExam(id, payload) {
  const sql = `UPDATE ex_exam SET exam_name = ?, start_time = ?, end_time = ?, duration_minutes = ?,
      pass_score = ?, anti_cheat_enabled = ?, anti_cheat_threshold = ?, description = ?
    WHERE id = ? AND deleted_at IS NULL`;
  const result = await db.query(sql, [
    payload.examName,
    payload.startTime,
    payload.endTime,
    payload.durationMinutes,
    payload.passScore,
    payload.antiCheatEnabled ? 1 : 0,
    payload.antiCheatThreshold,
    payload.description || null,
    id,
  ]);
  return result.affectedRows;
}

async function updateExamStatus(id, status, endTime = null) {
  const sql = `UPDATE ex_exam SET status = ?, end_time = COALESCE(?, end_time)
    WHERE id = ? AND deleted_at IS NULL`;
  const result = await db.query(sql, [status, endTime, id]);
  return result.affectedRows;
}

async function setScorePublished(id, publishedBy) {
  const sql = `UPDATE ex_exam SET score_status = 'published', score_published_at = UTC_TIMESTAMP(3),
      published_by = ?, status = CASE WHEN status IN ('finished','ongoing','published') THEN 'finished' ELSE status END
    WHERE id = ? AND score_status = 'unpublished'`;
  const result = await db.query(sql, [publishedBy, id]);
  return result.affectedRows;
}

/* ------------------------------ 参考范围 ------------------------------ */

async function listScopes(examId) {
  const sql = 'SELECT id, scope_type, class_id, student_id FROM ex_exam_scope WHERE exam_id = ? ORDER BY id ASC';
  const rows = await db.query(sql, [examId]);
  return {
    classIds: rows.filter((row) => row.scope_type === 'class').map((row) => Number(row.class_id)),
    studentIds: rows.filter((row) => row.scope_type === 'student').map((row) => Number(row.student_id)),
  };
}

async function replaceScopes(examId, { classIds = [], studentIds = [] }, conn) {
  await conn.query('DELETE FROM ex_exam_scope WHERE exam_id = ?', [examId]);
  const values = [];
  for (const classId of classIds) values.push([examId, 'class', classId, null]);
  for (const studentId of studentIds) values.push([examId, 'student', null, studentId]);
  if (values.length > 0) {
    await conn.query('INSERT INTO ex_exam_scope (exam_id, scope_type, class_id, student_id) VALUES ?', [values]);
  }
  return values.length;
}

/* ------------------------------ 考试任务 ------------------------------ */

function mapTask(row) {
  if (!row) return null;
  return {
    taskId: Number(row.id),
    examId: Number(row.exam_id),
    studentId: Number(row.student_id),
    studentNo: row.username,
    studentName: row.real_name,
    className: row.class_name || null,
    status: row.status,
    attemptsAllowed: Number(row.attempts_allowed),
    attemptsUsed: Number(row.attempts_used),
    notifiedAt: row.notified_at ? new Date(row.notified_at).toISOString() : null,
  };
}

const TASK_COLUMNS = `t.id, t.exam_id, t.student_id, t.status, t.attempts_allowed, t.attempts_used,
  t.notified_at, u.username, u.real_name, c.class_name`;
const TASK_FROM = `FROM ex_exam_task t
  JOIN sys_user u ON u.id = t.student_id
  LEFT JOIN sys_class c ON c.id = u.class_id`;

async function createTasks(examId, studentIds, attemptsAllowed, conn) {
  if (studentIds.length === 0) return 0;
  const values = studentIds.map((studentId) => [examId, studentId, 'pending', attemptsAllowed, 0, new Date()]);
  const [result] = await conn.query(
    `INSERT INTO ex_exam_task (exam_id, student_id, status, attempts_allowed, attempts_used, notified_at)
     VALUES ? ON DUPLICATE KEY UPDATE attempts_allowed = GREATEST(attempts_allowed, VALUES(attempts_allowed)),
       notified_at = COALESCE(notified_at, UTC_TIMESTAMP(3))`,
    [values],
  );
  return result.affectedRows;
}

async function listTasks(examId, status, { limit, offset }) {
  const where = ['t.exam_id = ?'];
  const params = [examId];
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  const sql = `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE ${where.join(' AND ')}
    ORDER BY u.username ASC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapTask);
}

async function countTasks(examId, status) {
  const where = ['exam_id = ?'];
  const params = [examId];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  return Number(await db.queryValue(`SELECT COUNT(*) AS total FROM ex_exam_task WHERE ${where.join(' AND ')}`, params));
}

async function findTask(examId, studentId, conn = null) {
  const sql = `SELECT id, exam_id, student_id, status, attempts_allowed, attempts_used, notified_at
    FROM ex_exam_task WHERE exam_id = ? AND student_id = ? LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [examId, studentId]))[0] : await db.query(sql, [examId, studentId]);
  return rows[0] ? mapTask(rows[0]) : null;
}

async function incrementTaskAttempts(examId, studentId, conn) {
  const sql = `UPDATE ex_exam_task SET attempts_used = attempts_used + 1, status = 'doing'
    WHERE exam_id = ? AND student_id = ? AND attempts_used < attempts_allowed`;
  const [result] = await conn.query(sql, [examId, studentId]);
  return result.affectedRows;
}

async function markTaskSubmitted(examId, studentId, conn = null) {
  const sql = "UPDATE ex_exam_task SET status = 'submitted' WHERE exam_id = ? AND student_id = ?";
  if (conn) {
    await conn.query(sql, [examId, studentId]);
    return;
  }
  await db.query(sql, [examId, studentId]);
}

async function markTaskMissed(examId, conn = null) {
  const sql = `UPDATE ex_exam_task t
    SET t.status = 'missed'
    WHERE t.exam_id = ? AND t.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM ex_exam_attempt a WHERE a.exam_id = t.exam_id AND a.student_id = t.student_id)`;
  if (conn) {
    await conn.query(sql, [examId]);
    return;
  }
  await db.query(sql, [examId]);
}

async function grantExtraAttempts(examId, studentId, extraAttempts, reason, grantedBy, conn) {
  const sql = `INSERT INTO ex_exam_attempt_grant (exam_id, student_id, extra_attempts, reason, granted_by)
    VALUES (?, ?, ?, ?, ?)`;
  await conn.query(sql, [examId, studentId, extraAttempts, reason, grantedBy]);
  await conn.query(
    `UPDATE ex_exam_task SET attempts_allowed = attempts_allowed + ?, notified_at = UTC_TIMESTAMP(3)
      WHERE exam_id = ? AND student_id = ?`,
    [extraAttempts, examId, studentId],
  );
}

async function taskStats(examId) {
  const sql = `SELECT status, COUNT(*) AS cnt FROM ex_exam_task WHERE exam_id = ? GROUP BY status`;
  const rows = await db.query(sql, [examId]);
  const stats = { total: 0, pending: 0, doing: 0, submitted: 0, missed: 0 };
  rows.forEach((row) => {
    stats[row.status] = Number(row.cnt);
    stats.total += Number(row.cnt);
  });
  return stats;
}

async function listTaskStudentIds(examId) {
  return (await db.query('SELECT student_id FROM ex_exam_task WHERE exam_id = ?', [examId])).map((row) => Number(row.student_id));
}

/* ------------------------------ 学生可参加考试 ------------------------------ */

async function listAvailableExams(studentId, { limit, offset }) {
  const sql = `SELECT ${EXAM_COLUMNS}, t.attempts_allowed, t.attempts_used, t.status AS task_status,
      (SELECT a.id FROM ex_exam_attempt a WHERE a.exam_id = e.id AND a.student_id = t.student_id
        AND a.status = 'ongoing' ORDER BY a.id DESC LIMIT 1) AS ongoing_attempt_id,
      (SELECT a.id FROM ex_exam_attempt a WHERE a.exam_id = e.id AND a.student_id = t.student_id
        ORDER BY a.attempt_seq DESC LIMIT 1) AS latest_attempt_id,
      (SELECT a.grading_status FROM ex_exam_attempt a WHERE a.exam_id = e.id AND a.student_id = t.student_id
        ORDER BY a.attempt_seq DESC LIMIT 1) AS latest_grading_status
    ${EXAM_FROM}
    JOIN ex_exam_task t ON t.exam_id = e.id AND t.student_id = ?
    WHERE e.deleted_at IS NULL AND e.status IN ('published','ongoing','finished')
    ORDER BY e.start_time ASC LIMIT ? OFFSET ?`;
  const rows = await db.query(sql, [studentId, limit, offset]);
  return rows.map((row) => ({
    ...mapExam(row),
    attemptsAllowed: Number(row.attempts_allowed),
    attemptsUsed: Number(row.attempts_used),
    taskStatus: row.task_status,
    ongoingAttemptId: row.ongoing_attempt_id ? Number(row.ongoing_attempt_id) : null,
    latestAttemptId: row.latest_attempt_id ? Number(row.latest_attempt_id) : null,
    latestGradeStatus: row.latest_grading_status || null,
  }));
}

async function countAvailableExams(studentId) {
  const sql = `SELECT COUNT(*) AS total FROM ex_exam e JOIN ex_exam_task t ON t.exam_id = e.id
    WHERE t.student_id = ? AND e.deleted_at IS NULL AND e.status IN ('published','ongoing','finished')`;
  return Number(await db.queryValue(sql, [studentId]));
}

/* ------------------------------ 监控与防作弊 ------------------------------ */

async function monitorCounts(examId) {
  const sql = `SELECT
      (SELECT COUNT(*) FROM ex_exam_task WHERE exam_id = ?) AS total_students,
      (SELECT COUNT(*) FROM ex_exam_task WHERE exam_id = ? AND status = 'doing') AS doing_count,
      (SELECT COUNT(*) FROM ex_exam_task WHERE exam_id = ? AND status = 'submitted') AS submitted_count,
      (SELECT COUNT(*) FROM ex_exam_task WHERE exam_id = ? AND status = 'missed') AS missed_count,
      (SELECT COUNT(*) FROM ex_exam_attempt WHERE exam_id = ? AND is_abnormal = 1) AS abnormal_count`;
  const row = await db.queryOne(sql, [examId, examId, examId, examId, examId]);
  return {
    totalStudents: Number(row.total_students),
    doingCount: Number(row.doing_count),
    submittedCount: Number(row.submitted_count),
    missedCount: Number(row.missed_count),
    abnormalCount: Number(row.abnormal_count),
  };
}

async function listAbnormalAttempts(examId, limit = 20) {
  const sql = `SELECT a.id, a.student_id, u.username, u.real_name, a.status, a.started_at, a.deadline_at,
      a.submitted_at, a.is_abnormal, a.abnormal_reason,
      (SELECT COUNT(*) FROM ex_attempt_question q WHERE q.attempt_id = a.id AND q.student_answer IS NOT NULL) AS answered_count,
      (SELECT COUNT(*) FROM ex_attempt_question q WHERE q.attempt_id = a.id) AS question_count
    FROM ex_exam_attempt a JOIN sys_user u ON u.id = a.student_id
    WHERE a.exam_id = ? AND a.is_abnormal = 1 ORDER BY a.updated_at DESC LIMIT ?`;
  return (await db.query(sql, [examId, limit])).map((row) => ({
    attemptId: Number(row.id),
    studentId: Number(row.student_id),
    studentNo: row.username,
    studentName: row.real_name,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    isAbnormal: Boolean(row.is_abnormal),
    abnormalReason: row.abnormal_reason,
    answeredCount: Number(row.answered_count),
    questionCount: Number(row.question_count),
  }));
}

function mapAntiCheat(row) {
  return {
    id: Number(row.id),
    attemptId: Number(row.attempt_id),
    studentId: Number(row.student_id),
    studentName: row.real_name,
    eventType: row.event_type,
    cumulativeCount: Number(row.cumulative_count),
    eventTime: row.event_time ? new Date(row.event_time).toISOString() : null,
    detail: parseJson(row.detail, null),
    ip: row.ip,
  };
}

async function listAntiCheatEvents(examId, filters, { limit, offset }) {
  const where = ['ace.exam_id = ?'];
  const params = [examId];
  if (filters.eventType) {
    where.push('ace.event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.attemptId) {
    where.push('ace.attempt_id = ?');
    params.push(filters.attemptId);
  }
  const sql = `SELECT ace.id, ace.attempt_id, ace.student_id, ace.event_type, ace.cumulative_count,
      ace.event_time, ace.detail, ace.ip, u.real_name
    FROM ex_anti_cheat_event ace JOIN sys_user u ON u.id = ace.student_id
    WHERE ${where.join(' AND ')} ORDER BY ace.event_time DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapAntiCheat);
}

async function countAntiCheatEvents(examId, filters) {
  const where = ['exam_id = ?'];
  const params = [examId];
  if (filters.eventType) {
    where.push('event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.attemptId) {
    where.push('attempt_id = ?');
    params.push(filters.attemptId);
  }
  return Number(await db.queryValue(`SELECT COUNT(*) AS total FROM ex_anti_cheat_event WHERE ${where.join(' AND ')}`, params));
}

async function findExamIdByAttempt(attemptId) {
  return db.queryValue('SELECT exam_id FROM ex_exam_attempt WHERE id = ?', [attemptId]);
}

async function existsExamForTeacher(examId, teacherId) {
  const total = Number(await db.queryValue(
    'SELECT COUNT(*) AS total FROM ex_exam WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    [examId, teacherId],
  ));
  return total > 0;
}

module.exports = {
  mapExam,
  listExams,
  countExams,
  findExamById,
  generateExamNo,
  createExam,
  updateExam,
  updateExamStatus,
  setScorePublished,
  listScopes,
  replaceScopes,
  mapTask,
  createTasks,
  listTasks,
  countTasks,
  findTask,
  incrementTaskAttempts,
  markTaskSubmitted,
  markTaskMissed,
  grantExtraAttempts,
  taskStats,
  listTaskStudentIds,
  listAvailableExams,
  countAvailableExams,
  monitorCounts,
  listAbnormalAttempts,
  mapAntiCheat,
  listAntiCheatEvents,
  countAntiCheatEvents,
  findExamIdByAttempt,
  existsExamForTeacher,
};