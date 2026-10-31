'use strict';

/** 成绩与统计查询（只读 ex_* / st_* / mk_* 表，不反向驱动业务） */
const db = require('../config/db');
const { toNum, parseJson } = require('../utils/mask');

/* ------------------------------ 个人成绩 ------------------------------ */

async function listMyGrades(studentId, { limit, offset }) {
  const sql = `SELECT a.id, a.exam_id, e.exam_name, a.submitted_at, e.score_status, a.total_score,
      a.objective_score, a.subjective_score, a.is_passed, a.grading_status, u.class_id, e.pass_score,
      (SELECT COUNT(*) + 1 FROM ex_exam_attempt b JOIN sys_user bu ON bu.id = b.student_id
        WHERE b.exam_id = a.exam_id AND b.status IN ('submitted','graded','reviewed')
          AND bu.class_id = u.class_id AND b.total_score > a.total_score) AS class_rank
    FROM ex_exam_attempt a
    JOIN ex_exam e ON e.id = a.exam_id
    JOIN sys_user u ON u.id = a.student_id
    WHERE a.student_id = ? AND a.status IN ('submitted','graded','reviewed')
    ORDER BY a.submitted_at DESC, a.id DESC LIMIT ? OFFSET ?`;
  const rows = await db.query(sql, [studentId, limit, offset]);
  return rows.map((row) => {
    const published = row.score_status === 'published';
    return {
      attemptId: Number(row.id),
      examId: Number(row.exam_id),
      examName: row.exam_name,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      scoreStatus: row.score_status,
      totalScore: published ? toNum(row.total_score) : null,
      objectiveScore: published ? toNum(row.objective_score) : null,
      subjectiveScore: published ? toNum(row.subjective_score) : null,
      isPassed: published && row.is_passed !== null ? Boolean(row.is_passed) : null,
      classRank: published ? Number(row.class_rank) : null,
      gradingStatus: row.grading_status,
    };
  });
}

async function countMyGrades(studentId) {
  const sql = `SELECT COUNT(*) AS total FROM ex_exam_attempt
    WHERE student_id = ? AND status IN ('submitted','graded','reviewed')`;
  return Number(await db.queryValue(sql, [studentId]));
}

async function getMyGradeDetail(attemptId) {
  const sql = `SELECT a.id, a.exam_id, e.exam_name, e.score_status, e.pass_score, e.score_published_at,
      a.submitted_at, a.total_score, a.objective_score, a.subjective_score, a.is_passed, a.grading_status,
      a.student_id, u.real_name AS student_name, u.class_id,
      (SELECT COUNT(*) + 1 FROM ex_exam_attempt b JOIN sys_user bu ON bu.id = b.student_id
        WHERE b.exam_id = a.exam_id AND b.status IN ('submitted','graded','reviewed')
          AND bu.class_id = u.class_id AND b.total_score > a.total_score) AS class_rank,
      (SELECT COUNT(*) FROM ex_exam_attempt b JOIN sys_user bu ON bu.id = b.student_id
        WHERE b.exam_id = a.exam_id AND b.status IN ('submitted','graded','reviewed')
          AND bu.class_id = u.class_id) AS class_total
    FROM ex_exam_attempt a
    JOIN ex_exam e ON e.id = a.exam_id
    JOIN sys_user u ON u.id = a.student_id
    WHERE a.id = ? LIMIT 1`;
  const row = await db.queryOne(sql, [attemptId]);
  if (!row) return null;
  const published = row.score_status === 'published';
  const rank = Number(row.class_rank);
  const total = Number(row.class_total);
  const percentile = total > 0 ? (rank / total) * 100 : null;
  let rankRange = null;
  if (percentile !== null) {
    if (percentile <= 10) rankRange = '前 10%';
    else if (percentile <= 20) rankRange = '前 20%';
    else if (percentile <= 50) rankRange = '前 50%';
    else rankRange = '后 50%';
  }
  return {
    attemptId: Number(row.id),
    examId: Number(row.exam_id),
    examName: row.exam_name,
    studentId: Number(row.student_id),
    studentName: row.student_name,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    scoreStatus: row.score_status,
    totalScore: published ? toNum(row.total_score) : null,
    objectiveScore: published ? toNum(row.objective_score) : null,
    subjectiveScore: published ? toNum(row.subjective_score) : null,
    isPassed: published && row.is_passed !== null ? Boolean(row.is_passed) : null,
    classRank: published ? rank : null,
    gradingStatus: row.grading_status,
    passScore: toNum(row.pass_score),
    rankRange: published ? rankRange : null,
  };
}

async function listGradeDetailQuestions(attemptId) {
  const sql = `SELECT id, question_id, order_no, question_type, full_score, question_snapshot,
      student_answer, auto_score, manual_score, final_score, is_correct, grader_comment
    FROM ex_attempt_question WHERE attempt_id = ? ORDER BY order_no ASC`;
  return (await db.query(sql, [attemptId])).map((row) => {
    const snapshot = parseJson(row.question_snapshot, {}) || {};
    return {
      questionId: Number(row.question_id),
      orderNo: Number(row.order_no),
      questionType: row.question_type,
      stem: snapshot.stem || '',
      options: snapshot.options || null,
      fullScore: toNum(row.full_score),
      studentAnswer: parseJson(row.student_answer, null),
      correctAnswer: snapshot.correctAnswer || null,
      analysis: snapshot.analysis || null,
      autoScore: toNum(row.auto_score),
      manualScore: row.manual_score === null ? null : toNum(row.manual_score),
      finalScore: toNum(row.final_score),
      isCorrect: row.is_correct === null ? null : Boolean(row.is_correct),
      graderComment: row.grader_comment,
    };
  });
}

/* ------------------------------ 考试成绩列表 ------------------------------ */

const SORT_COLUMNS = { totalScore: 'a.total_score', submittedAt: 'a.submitted_at' };

async function listExamScores(examId, filters, { limit, offset }) {
  const sortColumn = SORT_COLUMNS[filters.sortBy] || 'a.total_score';
  const order = filters.order === 'asc' ? 'ASC' : 'DESC';
  const params = [examId];
  let classFilter = '';
  if (filters.classId) {
    classFilter = 'AND u.class_id = ?';
    params.push(filters.classId);
  }
  const sql = `SELECT a.id, a.student_id, u.username, u.real_name, c.class_name, a.total_score,
      a.objective_score, a.subjective_score, a.is_passed, a.grading_status, a.submitted_at,
      (SELECT COUNT(*) + 1 FROM ex_exam_attempt b JOIN sys_user bu ON bu.id = b.student_id
        WHERE b.exam_id = a.exam_id AND b.status IN ('submitted','graded','reviewed')
          AND bu.class_id = u.class_id AND b.total_score > a.total_score) AS class_rank
    FROM ex_exam_attempt a
    JOIN sys_user u ON u.id = a.student_id
    LEFT JOIN sys_class c ON c.id = u.class_id
    WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed') ${classFilter}
    ORDER BY ${sortColumn} ${order}, a.id ASC LIMIT ? OFFSET ?`;
  return (await db.query(sql, [...params, limit, offset])).map((row) => ({
    attemptId: Number(row.id),
    studentId: Number(row.student_id),
    studentNo: row.username,
    studentName: row.real_name,
    className: row.class_name || null,
    totalScore: toNum(row.total_score),
    objectiveScore: toNum(row.objective_score),
    subjectiveScore: toNum(row.subjective_score),
    isPassed: row.is_passed === null ? null : Boolean(row.is_passed),
    gradingStatus: row.grading_status,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    classRank: Number(row.class_rank),
  }));
}

async function countExamScores(examId, classId) {
  const params = [examId];
  let classFilter = '';
  if (classId) {
    classFilter = 'AND u.class_id = ?';
    params.push(classId);
  }
  const sql = `SELECT COUNT(*) AS total FROM ex_exam_attempt a JOIN sys_user u ON u.id = a.student_id
    WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed') ${classFilter}`;
  return Number(await db.queryValue(sql, params));
}

async function listExamScoresExport(examId, classId, maxRows = 10000) {
  const params = [examId];
  let classFilter = '';
  if (classId) {
    classFilter = 'AND u.class_id = ?';
    params.push(classId);
  }
  const sql = `SELECT a.id, a.student_id, u.username, u.real_name, c.class_name, a.total_score,
      a.objective_score, a.subjective_score, a.is_passed, a.grading_status, a.submitted_at,
      (SELECT COUNT(*) + 1 FROM ex_exam_attempt b JOIN sys_user bu ON bu.id = b.student_id
        WHERE b.exam_id = a.exam_id AND b.status IN ('submitted','graded','reviewed')
          AND bu.class_id = u.class_id AND b.total_score > a.total_score) AS class_rank
    FROM ex_exam_attempt a JOIN sys_user u ON u.id = a.student_id
    LEFT JOIN sys_class c ON c.id = u.class_id
    WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed') ${classFilter}
    ORDER BY a.total_score DESC, a.id ASC LIMIT ?`;
  return (await db.query(sql, [...params, maxRows])).map((row) => ({
    attemptId: Number(row.id),
    studentId: Number(row.student_id),
    studentNo: row.username,
    studentName: row.real_name,
    className: row.class_name || null,
    totalScore: toNum(row.total_score),
    objectiveScore: toNum(row.objective_score),
    subjectiveScore: toNum(row.subjective_score),
    isPassed: row.is_passed === null ? null : Boolean(row.is_passed),
    gradingStatus: row.grading_status,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    classRank: Number(row.class_rank),
  }));
}

/* ------------------------------ 单场统计 ------------------------------ */

async function examStatistics(examId) {
  const exam = await db.queryOne(
    'SELECT id, exam_name, pass_score, start_time FROM ex_exam WHERE id = ? AND deleted_at IS NULL',
    [examId],
  );
  if (!exam) return null;
  const baseSql = `SELECT
      COUNT(a.id) AS submitted_count,
      COALESCE(ROUND(AVG(a.total_score), 2), 0) AS avg_score,
      COALESCE(MAX(a.total_score), 0) AS max_score,
      COALESCE(MIN(a.total_score), 0) AS min_score,
      COALESCE(ROUND(STDDEV_POP(a.total_score), 2), 0) AS std_dev,
      COALESCE(SUM(a.total_score >= ?), 0) AS pass_count,
      COALESCE(SUM(a.total_score >= ? * 0.9), 0) AS excellent_count
    FROM ex_exam_attempt a
    WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed')`;
  const base = await db.queryOne(baseSql, [exam.pass_score, exam.pass_score, examId]);
  const participantCount = Number(await db.queryValue('SELECT COUNT(*) AS total FROM ex_exam_task WHERE exam_id = ?', [examId]));
  const submittedCount = Number(base.submitted_count);
  const absentCount = Math.max(0, participantCount - submittedCount);

  const distSql = `SELECT CASE
        WHEN a.total_score >= ? * 0.9 THEN '90-100'
        WHEN a.total_score >= ? * 0.8 THEN '80-89'
        WHEN a.total_score >= ? * 0.7 THEN '70-79'
        WHEN a.total_score >= ? * 0.6 THEN '60-69'
        ELSE '0-59' END AS range_label,
      COUNT(*) AS cnt
    FROM ex_exam_attempt a
    WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed')
    GROUP BY range_label`;
  const distRows = await db.query(distSql, [exam.pass_score, exam.pass_score, exam.pass_score, exam.pass_score, examId]);
  const labels = ['90-100', '80-89', '70-79', '60-69', '0-59'];
  const distMap = new Map(distRows.map((row) => [row.range_label, Number(row.cnt)]));
  const scoreDistribution = labels.map((label) => {
    const count = distMap.get(label) || 0;
    return { range: label, count, ratio: submittedCount > 0 ? Number(((count / submittedCount) * 100).toFixed(2)) : 0 };
  });

  return {
    examId: Number(exam.id),
    examName: exam.exam_name,
    participantCount,
    submittedCount,
    absentCount,
    submitRate: participantCount > 0 ? Number(((submittedCount / participantCount) * 100).toFixed(2)) : 0,
    avgScore: toNum(base.avg_score),
    maxScore: toNum(base.max_score),
    minScore: toNum(base.min_score),
    stdDev: toNum(base.std_dev),
    passCount: Number(base.pass_count),
    passRate: submittedCount > 0 ? Number(((Number(base.pass_count) / submittedCount) * 100).toFixed(2)) : 0,
    excellentCount: Number(base.excellent_count),
    excellentRate: submittedCount > 0 ? Number(((Number(base.excellent_count) / submittedCount) * 100).toFixed(2)) : 0,
    scoreDistribution,
    calculatedAt: new Date().toISOString(),
  };
}

async function saveExamStatistics(stat) {
  const sql = `INSERT INTO st_exam_stat
    (exam_id, participant_count, submitted_count, absent_count, submit_rate, avg_score, max_score,
     min_score, std_dev, pass_count, pass_rate, excellent_count, excellent_rate, score_distribution, calc_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE participant_count = VALUES(participant_count), submitted_count = VALUES(submitted_count),
      absent_count = VALUES(absent_count), submit_rate = VALUES(submit_rate), avg_score = VALUES(avg_score),
      max_score = VALUES(max_score), min_score = VALUES(min_score), std_dev = VALUES(std_dev),
      pass_count = VALUES(pass_count), pass_rate = VALUES(pass_rate), excellent_count = VALUES(excellent_count),
      excellent_rate = VALUES(excellent_rate), score_distribution = VALUES(score_distribution),
      calc_at = UTC_TIMESTAMP(3)`;
  await db.query(sql, [
    stat.examId,
    stat.participantCount,
    stat.submittedCount,
    stat.absentCount,
    stat.submitRate,
    stat.avgScore,
    stat.maxScore,
    stat.minScore,
    stat.stdDev,
    stat.passCount,
    stat.passRate,
    stat.excellentCount,
    stat.excellentRate,
    JSON.stringify(stat.scoreDistribution),
  ]);
}

/* ------------------------------ 题目质量分析 ------------------------------ */

async function questionAnalysis(examId) {
  const exam = await db.queryOne(
    'SELECT id, exam_name, start_time FROM ex_exam WHERE id = ? AND deleted_at IS NULL',
    [examId],
  );
  if (!exam) return null;
  const attemptCount = Number(await db.queryValue(
    `SELECT COUNT(*) AS total FROM ex_exam_attempt WHERE exam_id = ? AND status IN ('submitted','graded','reviewed')`,
    [examId],
  ));
  const groupSize = Math.max(1, Math.ceil(attemptCount * 0.27));
  const highCutRow = attemptCount > 0
    ? await db.queryOne(
      `SELECT a.total_score FROM ex_exam_attempt a
        WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed')
        ORDER BY a.total_score DESC LIMIT 1 OFFSET ?`,
      [examId, groupSize - 1],
    )
    : null;
  const lowCutRow = attemptCount > 0
    ? await db.queryOne(
      `SELECT a.total_score FROM ex_exam_attempt a
        WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed')
        ORDER BY a.total_score DESC LIMIT 1 OFFSET ?`,
      [examId, Math.max(0, attemptCount - groupSize)],
    )
    : null;
  const highCut = highCutRow ? toNum(highCutRow.total_score) : null;
  const lowCut = lowCutRow ? toNum(lowCutRow.total_score) : null;

  const sql = `SELECT q.question_id, q.question_type, MAX(q.full_score) AS full_score,
      COUNT(q.id) AS total_rows,
      SUM(CASE WHEN q.student_answer IS NOT NULL THEN 1 ELSE 0 END) AS answer_count,
      SUM(CASE WHEN q.is_correct = 1 THEN 1 ELSE 0 END) AS correct_count,
      COALESCE(AVG(q.final_score / NULLIF(q.full_score, 0)), 0) AS avg_rate,
      COALESCE(AVG(CASE WHEN a.total_score >= ? THEN q.final_score / NULLIF(q.full_score, 0) END), 0) AS high_rate,
      COALESCE(AVG(CASE WHEN a.total_score <= ? THEN q.final_score / NULLIF(q.full_score, 0) END), 0) AS low_rate,
      ANY_VALUE(q.question_snapshot) AS question_snapshot
    FROM ex_attempt_question q
    JOIN ex_exam_attempt a ON a.id = q.attempt_id
    WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed')
    GROUP BY q.question_id, q.question_type
    ORDER BY q.question_id ASC`;
  const rows = await db.query(sql, [highCut === null ? -1 : highCut, lowCut === null ? -1 : lowCut, examId]);

  const questions = rows.map((row) => {
    const snapshot = parseJson(row.question_snapshot, {}) || {};
    const answerCount = Number(row.answer_count);
    const fullScore = toNum(row.full_score);
    const avgRate = toNum(row.avg_rate) * 100;
    const correctRate = row.question_type === 'short'
      ? avgRate
      : (answerCount > 0 ? (Number(row.correct_count) / answerCount) * 100 : 0);
    const highGroupRate = toNum(row.high_rate) * 100;
    const lowGroupRate = toNum(row.low_rate) * 100;
    const difficultyIndex = fullScore > 0 ? Number((toNum(row.avg_rate) * 1).toFixed(4)) : 0;
    const discriminationIndex = Number(((highGroupRate - lowGroupRate) / 100).toFixed(4));
    let isAbnormal = false;
    let abnormalReason = null;
    if (correctRate < 30) {
      isAbnormal = true;
      abnormalReason = '正确率低于 30%，题目过难或可能存在答案错误';
    } else if (correctRate > 95) {
      isAbnormal = true;
      abnormalReason = '正确率高于 95%，题目过易或区分度低';
    } else if (discriminationIndex < 0.2) {
      isAbnormal = true;
      abnormalReason = '区分度不足（<0.2）';
    }
    return {
      questionId: Number(row.question_id),
      questionNo: snapshot.questionNo || null,
      questionType: row.question_type,
      stem: snapshot.stem || '',
      fullScore,
      answerCount,
      correctRate: Number(correctRate.toFixed(2)),
      avgScoreRate: Number(avgRate.toFixed(2)),
      difficultyIndex,
      highGroupRate: Number(highGroupRate.toFixed(2)),
      lowGroupRate: Number(lowGroupRate.toFixed(2)),
      discriminationIndex,
      isAbnormal,
      abnormalReason,
    };
  });

  return {
    examId: Number(exam.id),
    examName: exam.exam_name,
    calculatedAt: new Date().toISOString(),
    questions,
  };
}

async function saveQuestionStatistics(examId, result) {
  if (result.questions.length === 0) return;
  const values = result.questions.map((q) => [
    examId,
    q.questionId,
    q.answerCount,
    Math.round((q.correctRate / 100) * q.answerCount),
    q.correctRate,
    q.avgScoreRate,
    q.difficultyIndex,
    q.highGroupRate,
    q.lowGroupRate,
    q.discriminationIndex,
    q.isAbnormal ? 1 : 0,
    q.abnormalReason,
  ]);
  const sql = `INSERT INTO st_question_stat
    (exam_id, question_id, answer_count, correct_count, correct_rate, avg_score_rate, difficulty_index,
     high_group_rate, low_group_rate, discrimination_index, is_abnormal, abnormal_reason)
    VALUES ? ON DUPLICATE KEY UPDATE answer_count = VALUES(answer_count), correct_count = VALUES(correct_count),
      correct_rate = VALUES(correct_rate), avg_score_rate = VALUES(avg_score_rate),
      difficulty_index = VALUES(difficulty_index), high_group_rate = VALUES(high_group_rate),
      low_group_rate = VALUES(low_group_rate), discrimination_index = VALUES(discrimination_index),
      is_abnormal = VALUES(is_abnormal), abnormal_reason = VALUES(abnormal_reason), calc_at = UTC_TIMESTAMP(3)`;
  await db.query(sql, [values]);
}

/* ------------------------------ 知识点失分 ------------------------------ */

async function knowledgePointStats(examId) {
  const sql = `SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(q.question_snapshot, '$.knowledgePointId')) AS UNSIGNED) AS kp_id,
      COUNT(DISTINCT q.attempt_id) AS student_count,
      COALESCE(SUM(q.full_score), 0) AS total_score,
      COALESCE(SUM(q.full_score - q.final_score), 0) AS lost_score
    FROM ex_attempt_question q
    JOIN ex_exam_attempt a ON a.id = q.attempt_id
    WHERE a.exam_id = ? AND a.status IN ('submitted','graded','reviewed')
      AND JSON_EXTRACT(q.question_snapshot, '$.knowledgePointId') IS NOT NULL
    GROUP BY kp_id ORDER BY lost_score DESC`;
  const rows = await db.query(sql, [examId]);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => Number(row.kp_id));
  const placeholders = ids.map(() => '?').join(',');
  const kpRows = await db.query(
    `SELECT id, kp_name, parent_id FROM kb_knowledge_point WHERE id IN (${placeholders})`,
    ids,
  );
  const nameMap = new Map(kpRows.map((row) => [Number(row.id), { name: row.kp_name, parentId: row.parent_id === null ? null : Number(row.parent_id) }]));
  return rows.map((row) => {
    const totalScore = toNum(row.total_score);
    const lostScore = toNum(row.lost_score);
    const meta = nameMap.get(Number(row.kp_id)) || {};
    return {
      knowledgePointId: Number(row.kp_id),
      knowledgePointName: meta.name || null,
      parentId: meta.parentId === undefined ? null : meta.parentId,
      studentCount: Number(row.student_count),
      totalScore,
      lostScore,
      lostRate: totalScore > 0 ? Number(((lostScore / totalScore) * 100).toFixed(2)) : 0,
    };
  });
}

async function saveKnowledgePointStatistics(examId, stats) {
  if (stats.length === 0) return;
  const values = stats.map((item) => [
    examId,
    item.knowledgePointId,
    item.studentCount,
    item.totalScore,
    item.lostScore,
    item.lostRate,
  ]);
  const sql = `INSERT INTO st_knowledge_stat
    (exam_id, knowledge_point_id, student_count, total_score, lost_score, lost_rate)
    VALUES ? ON DUPLICATE KEY UPDATE student_count = VALUES(student_count), total_score = VALUES(total_score),
      lost_score = VALUES(lost_score), lost_rate = VALUES(lost_rate), calc_at = UTC_TIMESTAMP(3)`;
  await db.query(sql, [values]);
}

/* ------------------------------ 趋势 ------------------------------ */

async function trendStatistics(examIds, classIds = []) {
  if (!examIds || examIds.length === 0) return [];
  const examPlaceholders = examIds.map(() => '?').join(',');
  const params = [...examIds];
  let classFilter = '';
  if (classIds.length > 0) {
    classFilter = `AND u.class_id IN (${classIds.map(() => '?').join(',')})`;
    params.push(...classIds);
  }
  const sql = `SELECT e.id AS exam_id, e.exam_name, DATE(e.start_time) AS exam_date,
      u.class_id, c.class_name,
      COUNT(a.id) AS submitted_count,
      COALESCE(ROUND(AVG(a.total_score), 2), 0) AS avg_score,
      COALESCE(SUM(a.total_score >= e.pass_score), 0) AS pass_count,
      COALESCE(SUM(a.total_score >= e.pass_score * 0.9), 0) AS excellent_count
    FROM ex_exam e
    JOIN ex_exam_attempt a ON a.exam_id = e.id AND a.status IN ('submitted','graded','reviewed')
    JOIN sys_user u ON u.id = a.student_id
    LEFT JOIN sys_class c ON c.id = u.class_id
    WHERE e.id IN (${examPlaceholders}) ${classFilter}
    GROUP BY e.id, e.exam_name, DATE(e.start_time), u.class_id, c.class_name
    ORDER BY exam_date ASC, e.id ASC`;
  const rows = await db.query(sql, params);
  return rows.map((row) => {
    const submitted = Number(row.submitted_count);
    return {
      examId: Number(row.exam_id),
      examName: row.exam_name,
      examDate: row.exam_date instanceof Date ? row.exam_date.toISOString().slice(0, 10) : String(row.exam_date),
      classId: row.class_id === null ? null : Number(row.class_id),
      className: row.class_name || null,
      avgScore: toNum(row.avg_score),
      passRate: submitted > 0 ? Number(((Number(row.pass_count) / submitted) * 100).toFixed(2)) : 0,
      excellentRate: submitted > 0 ? Number(((Number(row.excellent_count) / submitted) * 100).toFixed(2)) : 0,
    };
  });
}

module.exports = {
  listMyGrades,
  countMyGrades,
  getMyGradeDetail,
  listGradeDetailQuestions,
  listExamScores,
  countExamScores,
  listExamScoresExport,
  examStatistics,
  saveExamStatistics,
  questionAnalysis,
  saveQuestionStatistics,
  knowledgePointStats,
  saveKnowledgePointStatistics,
  trendStatistics,
};