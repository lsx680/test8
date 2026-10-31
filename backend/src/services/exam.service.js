'use strict';

/** 考试管理服务：创建/编辑/发布/变更、参考范围、任务、补考授权、监控与防作弊查询 */
const examModel = require('../models/exam.model');
const paperModel = require('../models/paper.model');
const systemModel = require('../models/system.model');
const userModel = require('../models/user.model');
const userService = require('./user.service');
const configService = require('./config.service');
const auditModel = require('../models/audit.model');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { parsePagination, pageResult } = require('../utils/pagination');
const { parseJson } = require('../utils/mask');

function assertExamAccess(exam, user) {
  if (!exam) throw fail(90401);
  if (user.roleCode === 'admin') return;
  if (Number(exam.ownerId) !== Number(user.id)) throw fail(90302);
}

function parseDate(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw fail(90101, { errors: [{ field: fieldName, message: '时间格式不合法（需 ISO-8601）' }] });
  }
  return date;
}

function validateWindow(startTime, endTime, durationMinutes) {
  const start = parseDate(startTime, 'startTime');
  const end = parseDate(endTime, 'endTime');
  if (end.getTime() <= start.getTime()) throw fail(40101);
  const windowMinutes = (end.getTime() - start.getTime()) / 60000;
  if (Number(durationMinutes) > windowMinutes) throw fail(40102, { data: { windowMinutes } });
  return { start, end };
}

async function buildExamDetail(exam, user) {
  const [scope, taskStats] = await Promise.all([
    examModel.listScopes(exam.id),
    examModel.taskStats(exam.id),
  ]);
  if (user.roleCode === 'student') {
    const task = await examModel.findTask(exam.id, user.id);
    if (!task) throw fail(40107);
  }
  return { ...exam, scope, taskStats };
}

/* ------------------------------ 查询 ------------------------------ */

async function listExams(query, user) {
  const pagination = parsePagination(query);
  const filters = {
    keyword: query.keyword,
    status: query.status,
    scoreStatus: query.scoreStatus,
  };
  const [list, total] = await Promise.all([
    examModel.listExams(filters, user, pagination),
    examModel.countExams(filters, user),
  ]);
  return pageResult(list, total, pagination);
}

async function getExam(examId, user) {
  const exam = await examModel.findExamById(examId);
  if (!exam) throw fail(90401);
  if (user.roleCode !== 'student') assertExamAccess(exam, user);
  return buildExamDetail(exam, user);
}

async function listAvailableExams(query, user) {
  if (user.roleCode !== 'student') throw fail(90301);
  const pagination = parsePagination(query);
  const [rows, total] = await Promise.all([
    examModel.listAvailableExams(user.id, pagination),
    examModel.countAvailableExams(user.id),
  ]);
  const now = Date.now();
  const list = rows.map((row) => {
    const startTime = new Date(row.startTime).getTime();
    const endTime = new Date(row.endTime).getTime();
    const remainingAttempts = Math.max(0, row.attemptsAllowed - row.attemptsUsed);
    let canStart = true;
    let rejectReason = null;
    if (row.ongoingAttemptId) {
      canStart = true;
      rejectReason = null;
    } else if (row.status === 'cancelled') {
      canStart = false;
      rejectReason = '考试已取消';
    } else if (now < startTime) {
      canStart = false;
      rejectReason = '考试尚未开始';
    } else if (now > endTime) {
      canStart = false;
      rejectReason = '考试已结束';
    } else if (remainingAttempts <= 0) {
      canStart = false;
      rejectReason = '作答次数已用尽，请联系教师申请补考';
    }
    return {
      ...row,
      remainingAttempts,
      canStart,
      rejectReason,
    };
  });
  return pageResult(list, total, pagination);
}

/* ------------------------------ 创建 / 编辑 ------------------------------ */

async function createExam(payload, user) {
  const paper = await paperModel.findPaperById(payload.paperId);
  if (!paper) throw fail(90401, { message: '试卷不存在' });
  if (user.roleCode !== 'admin' && Number(paper.ownerId) !== Number(user.id)) throw fail(90302);
  if (paper.status === 'archived') throw fail(30104);
  if (paper.status === 'deleted') throw fail(90401);
  if (paper.questionCount === 0) throw fail(30102);

  const { start, end } = validateWindow(payload.startTime, payload.endTime, payload.durationMinutes);
  if (!payload.scope || ((payload.scope.classIds || []).length === 0 && (payload.scope.studentIds || []).length === 0)) {
    throw fail(40103);
  }
  const studentIds = await userService.resolveScopeStudents({
    classIds: payload.scope.classIds || [],
    studentIds: payload.scope.studentIds || [],
  });
  if (studentIds.length === 0) throw fail(40103, { message: '参考范围未匹配到任何有效学生' });

  const defaultPassScore = await configService.getNumber('exam.passScore');
  const defaultThreshold = await configService.getNumber('exam.antiCheatThreshold');
  const examNo = await examModel.generateExamNo();

  const examId = await db.withTransaction(async (conn) => {
    const id = await examModel.createExam({
      examNo,
      examName: payload.examName,
      paperId: paper.id,
      ownerId: user.id,
      startTime: start,
      endTime: end,
      durationMinutes: payload.durationMinutes,
      passScore: payload.passScore === undefined ? defaultPassScore : payload.passScore,
      maxAttempts: payload.maxAttempts || 1,
      shuffleQuestions: payload.shuffleQuestions,
      antiCheatEnabled: payload.antiCheatEnabled,
      antiCheatThreshold: payload.antiCheatThreshold === undefined ? defaultThreshold : payload.antiCheatThreshold,
      autoSubmitOnTimeout: payload.autoSubmitOnTimeout,
      description: payload.description,
      createdBy: user.id,
    }, conn);
    await examModel.replaceScopes(id, payload.scope, conn);
    const affected = await paperModel.incrementUsedCount(paper.id, conn);
    if (affected === 0) throw fail(30104);
    await auditModel.write({
      userId: user.id,
      module: 'exm',
      action: 'exam.create',
      requestSummary: { examId: id, paperId: paper.id, studentCount: studentIds.length },
      result: 'success',
    }, conn);
    return id;
  });

  const created = await examModel.findExamById(examId);
  return buildExamDetail(created, user);
}

async function updateExam(examId, payload, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  if (['cancelled', 'archived'].includes(exam.status)) throw fail(40111);

  const lockedStatuses = ['published', 'ongoing', 'finished'];
  if (lockedStatuses.includes(exam.status)) {
    const allowed = new Set(['startTime', 'endTime', 'description', 'antiCheatEnabled', 'antiCheatThreshold']);
    const illegal = Object.keys(payload).filter((key) => !allowed.has(key));
    if (illegal.length > 0) throw fail(40111, { message: `已发布考试仅允许延期、调整说明与防作弊配置，非法字段：${illegal.join(',')}` });
    if (payload.scope) throw fail(40111, { message: '已发布考试不允许修改参考范围' });
  }

  const startTime = payload.startTime || exam.startTime;
  const endTime = payload.endTime || exam.endTime;
  const durationMinutes = payload.durationMinutes || exam.durationMinutes;
  const { start, end } = validateWindow(startTime, endTime, durationMinutes);

  if (payload.scope && !lockedStatuses.includes(exam.status)) {
    const studentIds = await userService.resolveScopeStudents({
      classIds: payload.scope.classIds || [],
      studentIds: payload.scope.studentIds || [],
    });
    if (studentIds.length === 0) throw fail(40103);
  }

  await db.withTransaction(async (conn) => {
    await examModel.updateExam(examId, {
      examName: payload.examName || exam.examName,
      startTime: start,
      endTime: end,
      durationMinutes,
      passScore: payload.passScore === undefined ? exam.passScore : payload.passScore,
      antiCheatEnabled: payload.antiCheatEnabled === undefined ? exam.antiCheatEnabled : payload.antiCheatEnabled,
      antiCheatThreshold: payload.antiCheatThreshold === undefined ? exam.antiCheatThreshold : payload.antiCheatThreshold,
      description: payload.description === undefined ? exam.description : payload.description,
    });
    if (payload.scope && !lockedStatuses.includes(exam.status)) {
      await examModel.replaceScopes(examId, payload.scope, conn);
    }
    await auditModel.write({
      userId: user.id,
      module: 'exm',
      action: 'exam.update',
      requestSummary: { examId, fields: Object.keys(payload) },
      result: 'success',
    }, conn);
  });
  return null;
}

/* ------------------------------ 发布 ------------------------------ */

async function publishExam(examId, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);

  if (exam.status === 'cancelled' || exam.status === 'archived') throw fail(40111);
  if (['published', 'ongoing', 'finished'].includes(exam.status)) {
    const taskStats = await examModel.taskStats(examId);
    return {
      examId: Number(examId),
      status: exam.status,
      taskCount: taskStats.total,
      notifiedCount: taskStats.total,
      publishedAt: exam.createdAt,
      replayed: true,
    };
  }

  const paper = await paperModel.findPaperById(exam.paperId);
  if (!paper) throw fail(90401);
  if (paper.status !== 'locked') throw fail(40112, { data: { paperStatus: paper.status } });

  const scope = await examModel.listScopes(examId);
  if (scope.classIds.length === 0 && scope.studentIds.length === 0) throw fail(40103);
  const studentIds = await userService.resolveScopeStudents(scope);
  if (studentIds.length === 0) throw fail(40103, { message: '参考范围未匹配到任何有效学生' });

  const result = await db.withTransaction(async (conn) => {
    const affected = await examModel.updateExamStatus(examId, 'published');
    if (affected === 0) throw fail(40111);
    const taskCount = await examModel.createTasks(examId, studentIds, exam.maxAttempts, conn);
    const items = studentIds.map((studentId) => ({
      userId: studentId,
      title: `考试安排：${exam.examName}`,
      content: `考试将于 ${new Date(exam.startTime).toISOString()} 开始，时长 ${exam.durationMinutes} 分钟，请提前做好准备。`,
      noticeType: 'exam_publish',
      bizType: 'exam',
      bizId: examId,
    }));
    const notifiedCount = await systemModel.createNotifications(items, conn);
    await auditModel.write({
      userId: user.id,
      module: 'exm',
      action: 'exam.publish',
      requestSummary: { examId, taskCount, notifiedCount },
      result: 'success',
    }, conn);
    return { taskCount, notifiedCount };
  });

  return {
    examId: Number(examId),
    status: 'published',
    taskCount: result.taskCount,
    notifiedCount: result.notifiedCount,
    publishedAt: new Date().toISOString(),
  };
}

async function updateExamStatus(examId, { status, endTime, reason, notifyStudents = true }, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  if (!['cancelled', 'archived', 'finished'].includes(status)) {
    throw fail(90101, { errors: [{ field: 'status', message: '仅支持 cancelled/archived/finished' }] });
  }
  if (status === 'archived' && user.roleCode !== 'admin') throw fail(90301);
  if (status === 'cancelled' && endTime) validateWindow(exam.startTime, endTime, exam.durationMinutes);

  await db.withTransaction(async (conn) => {
    await examModel.updateExamStatus(examId, status, endTime ? new Date(endTime) : null);
    if (status === 'finished') await examModel.markTaskMissed(examId, conn);
    if (notifyStudents && ['cancelled'].includes(status)) {
      const studentIds = await examModel.listTaskStudentIds(examId);
      await systemModel.createNotifications(studentIds.map((studentId) => ({
        userId: studentId,
        title: `考试变更：${exam.examName}`,
        content: reason || `考试状态已变更为 ${status}`,
        noticeType: 'exam_change',
        bizType: 'exam',
        bizId: examId,
      })), conn);
    }
    await auditModel.write({
      userId: user.id,
      module: 'exm',
      action: 'exam.status',
      requestSummary: { examId, status, endTime, reason: reason || null },
      result: 'success',
    }, conn);
  });
  return null;
}

/* ------------------------------ 任务与授权 ------------------------------ */

async function listExamTasks(examId, query, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const pagination = parsePagination(query);
  const [list, total, stats] = await Promise.all([
    examModel.listTasks(examId, query.status, pagination),
    examModel.countTasks(examId, query.status),
    examModel.taskStats(examId),
  ]);
  return pageResult(list, total, pagination, stats);
}

async function grantExtraAttempts(examId, { studentIds, extraAttempts, reason }, user, ip) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  if (['cancelled', 'archived'].includes(exam.status)) throw fail(40111);
  const tasks = await Promise.all(studentIds.map((studentId) => examModel.findTask(examId, studentId)));
  const missing = studentIds.filter((studentId, index) => !tasks[index]);
  if (missing.length > 0) throw fail(40107, { data: { missingStudentIds: missing } });

  await db.withTransaction(async (conn) => {
    for (const studentId of studentIds) {
      await examModel.grantExtraAttempts(examId, studentId, extraAttempts, reason, user.id, conn);
    }
    await systemModel.createNotifications(studentIds.map((studentId) => ({
      userId: studentId,
      title: `补考授权：${exam.examName}`,
      content: `教师已为您增加 ${extraAttempts} 次作答机会。原因：${reason}`,
      noticeType: 'exam_change',
      bizType: 'exam',
      bizId: examId,
    })), conn);
    await auditModel.write({
      userId: user.id,
      module: 'exm',
      action: 'exam.grant',
      ip,
      requestSummary: { examId, studentIds, extraAttempts, reason },
      result: 'success',
    }, conn);
  });
  return null;
}

/* ------------------------------ 监控 ------------------------------ */

async function getExamMonitor(examId, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const [counts, abnormalAttempts] = await Promise.all([
    examModel.monitorCounts(examId),
    examModel.listAbnormalAttempts(examId),
  ]);
  return {
    examId: Number(examId),
    examName: exam.examName,
    totalStudents: counts.totalStudents,
    doingCount: counts.doingCount,
    submittedCount: counts.submittedCount,
    missedCount: counts.missedCount,
    abnormalCount: counts.abnormalCount,
    onlineRate: counts.totalStudents > 0
      ? Number((((counts.doingCount + counts.submittedCount) / counts.totalStudents) * 100).toFixed(2))
      : 0,
    serverTime: new Date().toISOString(),
    abnormalAttempts,
  };
}

async function listAntiCheatEvents(examId, query, user) {
  const exam = await examModel.findExamById(examId);
  assertExamAccess(exam, user);
  const pagination = parsePagination(query);
  const filters = {
    eventType: query.eventType,
    attemptId: query.attemptId ? Number(query.attemptId) : null,
  };
  const [list, total] = await Promise.all([
    examModel.listAntiCheatEvents(examId, filters, pagination),
    examModel.countAntiCheatEvents(examId, filters),
  ]);
  return pageResult(list, total, pagination);
}

module.exports = {
  listExams,
  getExam,
  listAvailableExams,
  createExam,
  updateExam,
  publishExam,
  updateExamStatus,
  listExamTasks,
  grantExtraAttempts,
  getExamMonitor,
  listAntiCheatEvents,
  assertExamAccess,
  buildExamDetail,
};