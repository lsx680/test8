'use strict';

/** 成绩与统计服务：个人成绩、成绩发布/导出、单场统计、题目质量、趋势、知识点、复核申诉 */
const statModel = require('../models/stat.model');
const attemptModel = require('../models/attempt.model');
const gradingModel = require('../models/grading.model');
const examModel = require('../models/exam.model');
const systemModel = require('../models/system.model');
const configService = require('./config.service');
const auditModel = require('../models/audit.model');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { parsePagination, pageResult } = require('../utils/pagination');

function assertExamAccess(exam, user) {
  if (!exam) throw fail(90401);
  if (user.roleCode === 'admin') return;
  if (Number(exam.ownerId) !== Number(user.id)) throw fail(90302);
}

function parseIdList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/* ------------------------------ 个人成绩 ------------------------------ */

async function listMyGrades(query, user) {
  if (user.roleCode !== 'student') throw fail(90301);
  const pagination = parsePagination(query);
  const [list, total] = await Promise.all([
    statModel.listMyGrades(user.id, pagination),
    statModel.countMyGrades(user.id),
  ]);
  return pageResult(list, total, pagination);
}

async function getMyGradeDetail(attemptId, user) {
  const attempt = await attemptModel.findById(attemptId);
  if (!attempt) throw fail(40114);
  if (user.roleCode !== 'admin' && Number(attempt.studentId) !== Number(user.id)) throw fail(40113);
  if (attempt.scoreStatus !== 'published') throw fail(60101);
  const detail = await statModel.getMyGradeDetail(attemptId);
  if (!detail) throw fail(40114);
  const questions = await statModel.listGradeDetailQuestions(attemptId);
  return { ...detail, questions };
}

async function exportMyGrades(user) {
  const rows = await statModel.listMyGrades(user.id, { limit: 1000, offset: 0 });
  await auditModel.write({
    userId: user.id,
    module: 'sta',
    action: 'grade.export.self',
    requestSummary: { count: rows.length },
    result: 'success',
  });
  return rows;
}

/* ------------------------------ 考试成绩 ------------------------------ */

async function listExamScores(examId, query, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const pagination = parsePagination(query);
  const filters = {
    classId: query.classId ? Number(query.classId) : null,
    sortBy: query.sortBy,
    order: query.order,
  };
  const [list, total] = await Promise.all([
    statModel.listExamScores(examId, filters, pagination),
    statModel.countExamScores(examId, filters.classId),
  ]);
  return pageResult(list, total, pagination);
}

async function exportExamScores(examId, query, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const total = await statModel.countExamScores(examId, query.classId ? Number(query.classId) : null);
  if (total > 10000) throw fail(60103, { data: { total, limit: 10000 } });
  const rows = await statModel.listExamScoresExport(examId, query.classId ? Number(query.classId) : null, 10000);
  await auditModel.write({
    userId: user.id,
    module: 'sta',
    action: 'grade.export',
    requestSummary: { examId, count: rows.length },
    result: 'success',
  });
  return rows;
}

async function publishScores(examId, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  if (exam.scoreStatus === 'published') throw fail(60102);
  const pending = await gradingModel.countPendingByExam(examId, user);
  if (pending > 0) throw fail(50109, { data: { pendingTasks: pending } });

  const appealWindowDays = await configService.getNumber('system.appealWindowDays');
  const publishedAt = new Date();
  const deadline = new Date(publishedAt.getTime() + appealWindowDays * 86400000);

  const notifiedCount = await db.withTransaction(async (conn) => {
    const affected = await examModel.setScorePublished(examId, user.id);
    if (affected === 0) throw fail(60102);
    await gradingModel.setAppealDeadlinesForExam(examId, deadline);
    const studentIds = await examModel.listTaskStudentIds(examId);
    const count = await systemModel.createNotifications(studentIds.map((studentId) => ({
      userId: studentId,
      title: `成绩发布：${exam.examName}`,
      content: '考试成绩已发布，可在“我的成绩”中查看；如有异议请在申诉期内提交复核申请。',
      noticeType: 'score_publish',
      bizType: 'exam',
      bizId: examId,
    })), conn);
    await auditModel.write({
      userId: user.id,
      module: 'sta',
      action: 'grade.publish',
      requestSummary: { examId, notifiedCount: count },
      result: 'success',
    }, conn);
    return count;
  });

  return {
    examId: Number(examId),
    scoreStatus: 'published',
    publishedAt: publishedAt.toISOString(),
    notifiedCount,
  };
}

/* ------------------------------ 统计 ------------------------------ */

async function getExamStatistics(examId, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const stat = await statModel.examStatistics(examId);
  if (!stat) throw fail(90401);
  await statModel.saveExamStatistics(stat);
  return stat;
}

async function getQuestionAnalysis(examId, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const result = await statModel.questionAnalysis(examId);
  if (!result) throw fail(90401);
  await statModel.saveQuestionStatistics(examId, result);
  return result;
}

async function getKnowledgePointStatistics(examId, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const stats = await statModel.knowledgePointStats(examId);
  await statModel.saveKnowledgePointStatistics(examId, stats);
  return stats;
}

async function getTrendStatistics(query, user) {
  const examIds = parseIdList(query.examIds);
  if (examIds.length === 0) throw fail(90101, { errors: [{ field: 'examIds', message: 'examIds 不能为空' }] });
  for (const examId of examIds) {
    const exam = await examModel.findExamById(examId);
    assertExamAccess(exam, user);
  }
  const classIds = parseIdList(query.classIds);
  const series = await statModel.trendStatistics(examIds, classIds);
  const knowledgePointLoss = classIds.length === 0 && examIds.length === 1
    ? await statModel.knowledgePointStats(examIds[0])
    : [];
  return { series, knowledgePointLoss };
}

/** 刷新物化统计（交卷/阅卷/发布/重判后触发，失败仅记录日志） */
async function refreshExamMaterialized(examId) {
  try {
    const [stat, questionAnalysis, knowledgeStats] = await Promise.all([
      statModel.examStatistics(examId),
      statModel.questionAnalysis(examId),
      statModel.knowledgePointStats(examId),
    ]);
    if (stat) await statModel.saveExamStatistics(stat);
    if (questionAnalysis) await statModel.saveQuestionStatistics(examId, questionAnalysis);
    await statModel.saveKnowledgePointStatistics(examId, knowledgeStats);
  } catch (err) {
    // 统计旁路失败不影响主流程
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ msg: 'stat.refresh.failed', examId, error: err.message }));
  }
}

/* ------------------------------ 复核申诉 ------------------------------ */

async function listAppeals(query, user) {
  const pagination = parsePagination(query);
  const filters = {
    examId: query.examId ? Number(query.examId) : null,
    status: query.status,
  };
  const [list, total] = await Promise.all([
    gradingModel.listAppeals(filters, user, pagination),
    gradingModel.countAppeals(filters, user),
  ]);
  return pageResult(list, total, pagination);
}

async function createAppeal(payload, user) {
  if (user.roleCode !== 'student') throw fail(90301);
  const exam = await examModel.findExamById(payload.examId);
  if (!exam) throw fail(90401);
  if (exam.scoreStatus !== 'published') throw fail(60101);

  const attempt = await attemptModel.latestForStudentExam(payload.examId, user.id);
  if (!attempt) throw fail(40114, { message: '未找到本人该场考试的答卷' });
  if (!['submitted', 'grading', 'graded', 'reviewed'].includes(attempt.status)) {
    throw fail(40109, { message: '答卷状态不允许申诉' });
  }
  if (payload.questionId) {
    const aq = await attemptModel.findAttemptQuestion(attempt.id, payload.questionId);
    if (!aq) throw fail(90101, { errors: [{ field: 'questionId', message: '该题目不属于本人答卷' }] });
  }

  const appealWindowDays = await configService.getNumber('system.appealWindowDays');
  const baseTime = exam.scorePublishedAt ? new Date(exam.scorePublishedAt).getTime() : Date.now();
  const deadline = new Date(baseTime + appealWindowDays * 86400000);
  if (Date.now() > deadline.getTime()) throw fail(50107, { data: { deadlineAt: deadline.toISOString() } });

  const duplicate = await gradingModel.findExistingAppeal(payload.examId, user.id, payload.questionId);
  if (duplicate) throw fail(50108);

  const appealNo = await gradingModel.generateAppealNo();
  const appealId = await gradingModel.createAppeal({
    appealNo,
    examId: payload.examId,
    attemptId: attempt.id,
    studentId: user.id,
    questionId: payload.questionId,
    reason: payload.reason,
    deadlineAt: deadline,
  });
  await systemModel.createNotifications([{
    userId: exam.ownerId,
    title: `成绩复核申请：${exam.examName}`,
    content: `${user.realName} 提交了成绩复核申请，请及时处理。`,
    noticeType: 'appeal',
    bizType: 'appeal',
    bizId: appealId,
  }]);
  await auditModel.write({
    userId: user.id,
    module: 'mrk',
    action: 'appeal.create',
    requestSummary: { appealId, examId: payload.examId, questionId: payload.questionId || null },
    result: 'success',
  });
  return gradingModel.findAppealById(appealId);
}

async function handleAppeal(appealId, payload, user) {
  const appeal = await gradingModel.findAppealById(appealId);
  if (!appeal) throw fail(90401);
  const exam = await examModel.findExamById(appeal.examId);
  if (!exam) throw fail(90401);
  if (user.roleCode !== 'admin' && Number(exam.ownerId) !== Number(user.id)) throw fail(90302);
  if (appeal.status !== 'pending') throw fail(90409, { message: '该申诉已处理' });

  if (payload.status === 'accepted') {
    if (payload.newScore === undefined || payload.newScore === null) {
      throw fail(90101, { errors: [{ field: 'newScore', message: '采纳申诉时必须提供修正后总分' }] });
    }
    if (Number(payload.newScore) < 0) throw fail(50101);
  }
  const attemptBefore = await attemptModel.findById(appeal.attemptId);

  await db.withTransaction(async (conn) => {
    const affected = await gradingModel.handleAppeal(appealId, {
      status: payload.status,
      comment: payload.comment,
      newScore: payload.status === 'accepted' ? Number(payload.newScore) : undefined,
      handlerId: user.id,
      oldScore: attemptBefore ? attemptBefore.totalScore : undefined,
    }, conn);
    if (affected === 0) throw fail(90409, { message: '该申诉已处理' });

    if (payload.status === 'accepted') {
      const attempt = await attemptModel.findById(appeal.attemptId, { conn });
      if (attempt) {
        const isPassed = Number(payload.newScore) >= attempt.passScore ? 1 : 0;
        await attemptModel.updateAttemptTotals(attempt.id, {
          objectiveScore: attempt.objectiveScore,
          subjectiveScore: attempt.subjectiveScore,
          totalScore: Number(payload.newScore),
          isPassed,
          gradingStatus: attempt.gradingStatus,
          status: 'reviewed',
          conn,
        });
        await gradingModel.logGradeChange({
          attemptId: attempt.id,
          changeType: 'appeal',
          oldTotalScore: attempt.totalScore,
          newTotalScore: Number(payload.newScore),
          operatorId: user.id,
          reason: payload.comment,
        }, conn);
      }
    }

    await systemModel.createNotifications([{
      userId: appeal.studentId,
      title: `成绩复核结果：${appeal.examName}`,
      content: payload.comment,
      noticeType: 'appeal',
      bizType: 'appeal',
      bizId: appealId,
    }], conn);
    await auditModel.write({
      userId: user.id,
      module: 'mrk',
      action: 'appeal.handle',
      requestSummary: { appealId, status: payload.status, newScore: payload.newScore },
      result: 'success',
    }, conn);
  });

  return gradingModel.findAppealById(appealId);
}

module.exports = {
  listMyGrades,
  getMyGradeDetail,
  exportMyGrades,
  listExamScores,
  exportExamScores,
  publishScores,
  getExamStatistics,
  getQuestionAnalysis,
  getKnowledgePointStatistics,
  getTrendStatistics,
  refreshExamMaterialized,
  listAppeals,
  createAppeal,
  handleAppeal,
};