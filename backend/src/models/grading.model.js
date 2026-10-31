'use strict';

/** 阅卷任务、成绩变更记录、成绩申诉数据访问层 */
const db = require('../config/db');
const { parseJson, toNum } = require('../utils/mask');

const TASK_COLUMNS = `t.id, t.exam_id, t.attempt_id, t.attempt_question_id, t.question_id, t.question_type,
  t.assignee_id, t.status, t.first_score, t.first_grader_id, t.first_graded_at, t.first_comment,
  t.second_score, t.second_grader_id, t.second_graded_at, t.second_comment, t.score_gap,
  t.arbitration_score, t.arbitrator_id, t.arbitrated_at, t.arbitration_reason, t.final_score, t.created_at,
  e.exam_name, e.owner_id AS exam_owner_id, a.student_id, u.username AS student_no, u.real_name AS student_name,
  q.full_score, q.question_snapshot, q.student_answer`;

const TASK_FROM = `FROM mk_grading_task t
  JOIN ex_exam e ON e.id = t.exam_id
  JOIN ex_exam_attempt a ON a.id = t.attempt_id
  JOIN sys_user u ON u.id = a.student_id
  JOIN ex_attempt_question q ON q.id = t.attempt_question_id`;

function mapTask(row) {
  if (!row) return null;
  return {
    taskId: Number(row.id),
    examId: Number(row.exam_id),
    examName: row.exam_name,
    attemptId: Number(row.attempt_id),
    attemptQuestionId: Number(row.attempt_question_id),
    questionId: Number(row.question_id),
    questionType: row.question_type,
    studentId: Number(row.student_id),
    studentNo: row.student_no,
    studentName: row.student_name,
    fullScore: toNum(row.full_score),
    status: row.status,
    assigneeId: row.assignee_id === null ? null : Number(row.assignee_id),
    firstScore: row.first_score === null ? null : toNum(row.first_score),
    secondScore: row.second_score === null ? null : toNum(row.second_score),
    finalScore: row.final_score === null ? null : toNum(row.final_score),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function mapTaskDetail(row) {
  if (!row) return null;
  const snapshot = parseJson(row.question_snapshot, {}) || {};
  return {
    ...mapTask(row),
    stem: snapshot.stem || '',
    options: snapshot.options || null,
    correctAnswer: snapshot.correctAnswer || null,
    scoringPoints: snapshot.scoringPoints || null,
    analysis: snapshot.analysis || null,
    studentAnswer: parseJson(row.student_answer, null),
    firstComment: row.first_comment,
    secondComment: row.second_comment,
    arbitrationScore: row.arbitration_score === null ? null : toNum(row.arbitration_score),
    arbitrationReason: row.arbitration_reason,
    assigneeId: row.assignee_id === null ? null : Number(row.assignee_id),
    examOwnerId: Number(row.exam_owner_id),
  };
}

function taskScope(scopeUser) {
  if (!scopeUser || scopeUser.roleCode === 'admin') return { sql: '1 = 1', params: [] };
  return { sql: 'e.owner_id = ?', params: [scopeUser.id] };
}

async function listTasks(filters, scopeUser, { limit, offset }) {
  const scope = taskScope(scopeUser);
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.examId) {
    where.push('t.exam_id = ?');
    params.push(filters.examId);
  }
  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.assigneeId) {
    where.push('t.assignee_id = ?');
    params.push(filters.assigneeId);
  }
  const sql = `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE ${where.join(' AND ')}
    ORDER BY t.created_at ASC, t.id ASC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapTask);
}

async function countTasks(filters, scopeUser) {
  const scope = taskScope(scopeUser);
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.examId) {
    where.push('t.exam_id = ?');
    params.push(filters.examId);
  }
  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.assigneeId) {
    where.push('t.assignee_id = ?');
    params.push(filters.assigneeId);
  }
  const sql = `SELECT COUNT(*) AS total FROM mk_grading_task t
    JOIN ex_exam e ON e.id = t.exam_id WHERE ${where.join(' AND ')}`;
  return Number(await db.queryValue(sql, params));
}

async function countPendingByExam(examId, scopeUser) {
  const scope = taskScope(scopeUser);
  const sql = `SELECT COUNT(*) AS total FROM mk_grading_task t JOIN ex_exam e ON e.id = t.exam_id
    WHERE t.exam_id = ? AND t.status <> 'done' AND ${scope.sql}`;
  return Number(await db.queryValue(sql, [examId, ...scope.params]));
}

async function findTaskById(taskId, conn = null) {
  const sql = `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.id = ? LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [taskId]))[0] : await db.query(sql, [taskId]);
  return mapTaskDetail(rows[0]);
}

async function findTaskByAttemptQuestion(attemptQuestionId) {
  const sql = `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.attempt_question_id = ? LIMIT 1`;
  return mapTaskDetail(await db.queryOne(sql, [attemptQuestionId]));
}

/** 交卷时为简答题生成阅卷任务（唯一索引防重复） */
async function createTasksForSubjective(attemptId, examId, conn) {
  const sql = `INSERT INTO mk_grading_task
      (exam_id, attempt_id, attempt_question_id, question_id, question_type, status)
    SELECT ?, q.attempt_id, q.id, q.question_id, q.question_type, 'pending'
      FROM ex_attempt_question q
     WHERE q.attempt_id = ? AND q.question_type = 'short' AND q.grade_status = 'pending'
    ON DUPLICATE KEY UPDATE updated_at = UTC_TIMESTAMP(3)`;
  const [result] = await conn.query(sql, [examId, attemptId]);
  return result.affectedRows;
}

async function listTasksByAttempt(attemptId, conn = null) {
  const sql = `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.attempt_id = ? ORDER BY t.id ASC`;
  const rows = conn ? (await conn.query(sql, [attemptId]))[0] : await db.query(sql, [attemptId]);
  return rows.map(mapTask);
}

async function firstPendingTaskId(attemptId, conn = null) {
  const sql = `SELECT id FROM mk_grading_task WHERE attempt_id = ? ORDER BY id ASC LIMIT 1`;
  const rows = conn ? (await conn.query(sql, [attemptId]))[0] : await db.query(sql, [attemptId]);
  return rows[0] ? Number(rows[0].id) : null;
}

async function updateFirstScore(taskId, { score, graderId, comment }, conn) {
  const sql = `UPDATE mk_grading_task SET first_score = ?, first_grader_id = ?, first_graded_at = UTC_TIMESTAMP(3),
      first_comment = ?, assignee_id = ?, final_score = ? WHERE id = ? AND status IN ('pending','second_pending')`;
  const [result] = await conn.query(sql, [score, graderId, comment || null, graderId, score, taskId]);
  return result.affectedRows;
}

async function updateSecondScore(taskId, { score, graderId, comment, scoreGap }, conn) {
  const sql = `UPDATE mk_grading_task SET second_score = ?, second_grader_id = ?, second_graded_at = UTC_TIMESTAMP(3),
      second_comment = ?, score_gap = ? WHERE id = ?`;
  const [result] = await conn.query(sql, [score, graderId, comment || null, scoreGap, taskId]);
  return result.affectedRows;
}

async function updateTaskStatus(taskId, status, conn) {
  const sql = 'UPDATE mk_grading_task SET status = ? WHERE id = ?';
  const [result] = await conn.query(sql, [status, taskId]);
  return result.affectedRows;
}

async function updateArbitration(taskId, { score, arbitratorId, reason, scoreGap }, conn) {
  const sql = `UPDATE mk_grading_task SET arbitration_score = ?, arbitrator_id = ?, arbitrated_at = UTC_TIMESTAMP(3),
      arbitration_reason = ?, final_score = ?, score_gap = ?, status = 'done' WHERE id = ?`;
  const [result] = await conn.query(sql, [score, arbitratorId, reason, score, scoreGap, taskId]);
  return result.affectedRows;
}

async function setTaskFinalScore(taskId, finalScore, status, graderId, conn) {
  const sql = `UPDATE mk_grading_task SET final_score = ?, status = ?, assignee_id = COALESCE(assignee_id, ?),
      updated_at = UTC_TIMESTAMP(3) WHERE id = ?`;
  await conn.query(sql, [finalScore, status, graderId || null, taskId]);
}

async function countTasksByAttempt(attemptId, conn = null) {
  const sql = `SELECT
      COUNT(*) AS total,
      SUM(status <> 'done') AS pending,
      SUM(status = 'arbitration') AS arbitration
    FROM mk_grading_task WHERE attempt_id = ?`;
  const rows = conn ? (await conn.query(sql, [attemptId]))[0] : await db.query(sql, [attemptId]);
  return {
    total: Number(rows[0].total || 0),
    pending: Number(rows[0].pending || 0),
    arbitration: Number(rows[0].arbitration || 0),
  };
}

async function examProgress(examId, scopeUser) {
  const scope = taskScope(scopeUser);
  const examCheck = scopeUser && scopeUser.roleCode !== 'admin'
    ? 'AND e.owner_id = ?'
    : '';
  const examParams = scopeUser && scopeUser.roleCode !== 'admin' ? [scopeUser.id] : [];
  const attemptsSql = `SELECT COUNT(*) AS total,
      SUM(a.grading_status IN ('done','auto_done')) AS graded,
      SUM(a.grading_status NOT IN ('done','auto_done')) AS pending
    FROM ex_exam_attempt a JOIN ex_exam e ON e.id = a.exam_id
    WHERE a.exam_id = ? AND a.status IN ('submitted','grading','graded','reviewed') ${examCheck}`;
  const tasksSql = `SELECT COUNT(*) AS total,
      SUM(t.status = 'done') AS done,
      SUM(t.status <> 'done' AND t.status <> 'arbitration') AS pending,
      SUM(t.status = 'arbitration') AS arbitration
    FROM mk_grading_task t JOIN ex_exam e ON e.id = t.exam_id
    WHERE t.exam_id = ? ${examCheck}`;
  const gradersSql = `SELECT t.assignee_id AS grader_id, u.real_name AS grader_name,
      COUNT(*) AS assigned_count,
      SUM(t.status = 'done') AS graded_count,
      SUM(t.status <> 'done') AS pending_count
    FROM mk_grading_task t
    JOIN ex_exam e ON e.id = t.exam_id
    LEFT JOIN sys_user u ON u.id = t.assignee_id
    WHERE t.exam_id = ? AND t.assignee_id IS NOT NULL ${examCheck}
    GROUP BY t.assignee_id, u.real_name ORDER BY assigned_count DESC`;
  const [attemptRow, taskRow, graders] = await Promise.all([
    db.queryOne(attemptsSql, [examId, ...examParams]),
    db.queryOne(tasksSql, [examId, ...examParams]),
    db.query(gradersSql, [examId, ...examParams]),
  ]);
  return {
    totalAttempts: Number(attemptRow.total || 0),
    gradedAttempts: Number(attemptRow.graded || 0),
    pendingAttempts: Number(attemptRow.pending || 0),
    totalSubjectiveTasks: Number(taskRow.total || 0),
    doneTasks: Number(taskRow.done || 0),
    pendingTasks: Number(taskRow.pending || 0),
    arbitrationTasks: Number(taskRow.arbitration || 0),
    graders: graders.map((row) => ({
      graderId: Number(row.grader_id),
      graderName: row.grader_name,
      assignedCount: Number(row.assigned_count),
      gradedCount: Number(row.graded_count),
      pendingCount: Number(row.pending_count),
    })),
  };
}

/* ------------------------------ 成绩变更记录 ------------------------------ */

async function logGradeChange(entry, conn) {
  const sql = `INSERT INTO mk_grade_change_log
    (attempt_id, attempt_question_id, change_type, old_score, new_score, old_total_score,
     new_total_score, operator_id, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await conn.query(sql, [
    entry.attemptId,
    entry.attemptQuestionId || null,
    entry.changeType,
    entry.oldScore === undefined ? null : entry.oldScore,
    entry.newScore === undefined ? null : entry.newScore,
    entry.oldTotalScore === undefined ? null : entry.oldTotalScore,
    entry.newTotalScore === undefined ? null : entry.newTotalScore,
    entry.operatorId,
    entry.reason || null,
  ]);
  return Number(result.insertId);
}

async function listGradeChanges(attemptId) {
  const sql = `SELECT l.id, l.attempt_id, l.attempt_question_id, l.change_type, l.old_score, l.new_score,
      l.old_total_score, l.new_total_score, l.operator_id, u.real_name AS operator_name, l.reason, l.created_at
    FROM mk_grade_change_log l LEFT JOIN sys_user u ON u.id = l.operator_id
    WHERE l.attempt_id = ? ORDER BY l.created_at ASC`;
  return (await db.query(sql, [attemptId])).map((row) => ({
    id: Number(row.id),
    attemptId: Number(row.attempt_id),
    attemptQuestionId: row.attempt_question_id === null ? null : Number(row.attempt_question_id),
    changeType: row.change_type,
    oldScore: row.old_score === null ? null : toNum(row.old_score),
    newScore: row.new_score === null ? null : toNum(row.new_score),
    oldTotalScore: row.old_total_score === null ? null : toNum(row.old_total_score),
    newTotalScore: row.new_total_score === null ? null : toNum(row.new_total_score),
    operatorId: Number(row.operator_id),
    operatorName: row.operator_name,
    reason: row.reason,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

/* ------------------------------ 成绩申诉 ------------------------------ */

const APPEAL_COLUMNS = `x.id, x.appeal_no, x.exam_id, x.attempt_id, x.student_id, x.question_id, x.reason,
  x.status, x.handler_id, x.handle_comment, x.old_score, x.new_score, x.deadline_at, x.created_at, x.handled_at,
  e.exam_name, u.real_name AS student_name, h.real_name AS handler_name`;

const APPEAL_FROM = `FROM mk_score_appeal x
  JOIN ex_exam e ON e.id = x.exam_id
  JOIN sys_user u ON u.id = x.student_id
  LEFT JOIN sys_user h ON h.id = x.handler_id`;

function mapAppeal(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    appealNo: row.appeal_no,
    examId: Number(row.exam_id),
    examName: row.exam_name,
    attemptId: Number(row.attempt_id),
    studentId: Number(row.student_id),
    studentName: row.student_name,
    questionId: row.question_id === null ? null : Number(row.question_id),
    reason: row.reason,
    status: row.status,
    handlerId: row.handler_id === null ? null : Number(row.handler_id),
    handlerName: row.handler_name,
    handleComment: row.handle_comment,
    oldScore: row.old_score === null ? null : toNum(row.old_score),
    newScore: row.new_score === null ? null : toNum(row.new_score),
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    handledAt: row.handled_at ? new Date(row.handled_at).toISOString() : null,
  };
}

function appealScope(user) {
  if (!user || user.roleCode === 'admin') return { sql: '1 = 1', params: [] };
  if (user.roleCode === 'student') return { sql: 'x.student_id = ?', params: [user.id] };
  return { sql: 'e.owner_id = ?', params: [user.id] };
}

async function listAppeals(filters, user, { limit, offset }) {
  const scope = appealScope(user);
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.examId) {
    where.push('x.exam_id = ?');
    params.push(filters.examId);
  }
  if (filters.status) {
    where.push('x.status = ?');
    params.push(filters.status);
  }
  const sql = `SELECT ${APPEAL_COLUMNS} ${APPEAL_FROM} WHERE ${where.join(' AND ')}
    ORDER BY x.created_at DESC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map(mapAppeal);
}

async function countAppeals(filters, user) {
  const scope = appealScope(user);
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.examId) {
    where.push('x.exam_id = ?');
    params.push(filters.examId);
  }
  if (filters.status) {
    where.push('x.status = ?');
    params.push(filters.status);
  }
  const sql = `SELECT COUNT(*) AS total FROM mk_score_appeal x
    JOIN ex_exam e ON e.id = x.exam_id WHERE ${where.join(' AND ')}`;
  return Number(await db.queryValue(sql, params));
}

async function findAppealById(id) {
  const sql = `SELECT ${APPEAL_COLUMNS} ${APPEAL_FROM} WHERE x.id = ? LIMIT 1`;
  return mapAppeal(await db.queryOne(sql, [id]));
}

async function findExistingAppeal(examId, studentId, questionId) {
  const sql = `SELECT id FROM mk_score_appeal
    WHERE exam_id = ? AND student_id = ? AND status IN ('pending','accepted')
      AND ((question_id IS NULL AND ? IS NULL) OR question_id = ?) LIMIT 1`;
  return db.queryOne(sql, [examId, studentId, questionId || null, questionId || null]);
}

async function generateAppealNo() {
  const year = new Date().getUTCFullYear();
  const prefix = `APL-${year}-`;
  const total = Number(await db.queryValue('SELECT COUNT(*) AS total FROM mk_score_appeal WHERE appeal_no LIKE ?', [`${prefix}%`]));
  return `${prefix}${String(total + 1).padStart(6, '0')}`;
}

async function createAppeal(payload) {
  const sql = `INSERT INTO mk_score_appeal
    (appeal_no, exam_id, attempt_id, student_id, question_id, reason, status, deadline_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`;
  const result = await db.query(sql, [
    payload.appealNo,
    payload.examId,
    payload.attemptId,
    payload.studentId,
    payload.questionId || null,
    payload.reason,
    payload.deadlineAt || null,
  ]);
  return Number(result.insertId);
}

async function handleAppeal(id, { status, comment, newScore, handlerId, oldScore }, conn = null) {
  const sql = `UPDATE mk_score_appeal SET status = ?, handle_comment = ?, new_score = ?,
      handler_id = ?, old_score = ?, handled_at = UTC_TIMESTAMP(3)
    WHERE id = ? AND status = 'pending'`;
  const params = [status, comment, newScore === undefined ? null : newScore, handlerId, oldScore, id];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return result.affectedRows;
  }
  const result = await db.query(sql, params);
  return result.affectedRows;
}

async function setAppealDeadlinesForExam(examId, deadlineAt) {
  const sql = `UPDATE mk_score_appeal SET deadline_at = ? WHERE exam_id = ? AND status = 'pending' AND deadline_at IS NULL`;
  await db.query(sql, [deadlineAt, examId]);
}

module.exports = {
  mapTask,
  mapTaskDetail,
  listTasks,
  countTasks,
  countPendingByExam,
  findTaskById,
  findTaskByAttemptQuestion,
  createTasksForSubjective,
  listTasksByAttempt,
  firstPendingTaskId,
  updateFirstScore,
  updateSecondScore,
  updateTaskStatus,
  updateArbitration,
  setTaskFinalScore,
  countTasksByAttempt,
  examProgress,
  logGradeChange,
  listGradeChanges,
  mapAppeal,
  listAppeals,
  countAppeals,
  findAppealById,
  findExistingAppeal,
  generateAppealNo,
  createAppeal,
  handleAppeal,
  setAppealDeadlinesForExam,
};