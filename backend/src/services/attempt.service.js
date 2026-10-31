'use strict';

/**
 * 在线答题服务：开考（服务端时间基准）、取题（强制脱敏）、答案暂存（UPSERT + 乐观锁）、
 * 服务端权威计时、幂等交卷、防作弊事件、断线恢复、超时自动交卷
 * 依据：设计文档 §3.5
 */
const crypto = require('crypto');
const attemptModel = require('../models/attempt.model');
const examModel = require('../models/exam.model');
const paperModel = require('../models/paper.model');
const gradingModel = require('../models/grading.model');
const systemModel = require('../models/system.model');
const auditModel = require('../models/audit.model');
const gradingService = require('./grading.service');
const gradeService = require('./grade.service');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { projectAttemptQuestion, parseJson } = require('../utils/mask');
const { SUBMIT_GRACE_SECONDS, ANTI_CHEAT_EVENTS } = require('../config/constants');

const GRACE_MS = SUBMIT_GRACE_SECONDS * 1000;

function assertOwner(attempt, user) {
  if (!attempt) throw fail(40114);
  if (user.roleCode === 'admin') return;
  if (Number(attempt.studentId) !== Number(user.id)) throw fail(40113);
}

/** 稳定哈希：用于按 attemptNo + questionId 打乱题目顺序（同一答卷多次请求顺序一致） */
function seedOrder(attemptNo, questionId) {
  const hash = crypto.createHash('sha1').update(`${attemptNo}:${questionId}`).digest();
  return hash.readUInt32BE(0);
}

function buildOrderedItems(paperQuestions, attemptNo, shuffle) {
  const items = paperQuestions.map((row) => ({
    paperQuestionId: row.paperQuestionId,
    questionId: row.questionId,
    questionType: row.questionType,
    fullScore: row.score,
    snapshot: row.questionSnapshot,
    baseOrder: row.orderNo,
  }));
  if (shuffle) {
    items.sort((a, b) => seedOrder(attemptNo, a.questionId) - seedOrder(attemptNo, b.questionId)
      || a.baseOrder - b.baseOrder);
  } else {
    items.sort((a, b) => a.baseOrder - b.baseOrder);
  }
  return items.map((item, index) => ({ ...item, orderNo: index + 1 }));
}

async function buildSession(attempt, { includeQuestions = true } = {}) {
  const remaining = await attemptModel.remainingSeconds(attempt.id);
  let questions = [];
  if (includeQuestions) {
    const rows = await attemptModel.listAttemptQuestions(attempt.id);
    questions = rows.map(projectAttemptQuestion);
  }
  return {
    attemptId: attempt.id,
    attemptNo: attempt.attemptNo,
    examId: attempt.examId,
    examName: attempt.examName,
    studentId: attempt.studentId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadlineAt: remaining ? remaining.deadlineAt : attempt.deadlineAt,
    remainingSeconds: remaining ? remaining.remainingSeconds : 0,
    serverTime: new Date().toISOString(),
    autoSubmitOnTimeout: attempt.autoSubmitOnTimeout,
    totalScore: attempt.totalScore,
    gradingStatus: attempt.gradingStatus,
    questions,
  };
}

/* ------------------------------ 开考 ------------------------------ */

async function startAttempt(examId, { deviceKey } = {}, user, { ip } = {}) {
  if (user.roleCode !== 'student') throw fail(90301);
  const exam = await examModel.findExamById(examId);
  if (!exam) throw fail(90401);
  if (!['published', 'ongoing'].includes(exam.status)) throw fail(40111, { data: { status: exam.status } });

  const task = await examModel.findTask(examId, user.id);
  if (!task) throw fail(40107);

  const now = Date.now();
  if (now < new Date(exam.startTime).getTime()) throw fail(40105);
  if (now > new Date(exam.endTime).getTime()) throw fail(40106);

  const ongoing = await attemptModel.findOngoing(examId, user.id);
  if (ongoing) return { replayed: true, session: await buildSession(ongoing) };
  if (task.attemptsUsed >= task.attemptsAllowed) throw fail(40108);

  const paperQuestions = await paperModel.listPaperQuestions(exam.paperId);
  if (paperQuestions.length === 0) throw fail(90409, { message: '试卷没有题目，无法开考' });

  const attemptNo = crypto.randomUUID();
  let attemptId;
  try {
    attemptId = await db.withTransaction(async (conn) => {
      // 事务内二次校验，配合唯一索引抵御并发重复开考
      const existing = await attemptModel.findOngoing(examId, user.id, conn);
      if (existing) return existing.id;
      const incremented = await examModel.incrementTaskAttempts(examId, user.id, conn);
      if (incremented === 0) throw fail(40108);
      const maxSeq = await attemptModel.findMaxSeq(examId, user.id, conn);
      const id = await attemptModel.createAttempt({
        attemptNo,
        examId,
        taskId: task.taskId,
        studentId: user.id,
        paperId: exam.paperId,
        attemptSeq: maxSeq + 1,
        durationMinutes: exam.durationMinutes,
        examEndTime: new Date(exam.endTime),
        deviceKey,
        ip,
      }, conn);
      const items = buildOrderedItems(paperQuestions, attemptNo, exam.shuffleQuestions);
      await attemptModel.insertAttemptQuestions(id, items, conn);
      await auditModel.write({
        userId: user.id,
        module: 'exm',
        action: 'attempt.start',
        ip,
        requestSummary: { attemptId: id, examId, attemptNo },
        result: 'success',
      }, conn);
      return id;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const existing = await attemptModel.findOngoing(examId, user.id);
      if (existing) return { replayed: true, session: await buildSession(existing) };
    }
    throw err;
  }

  const attempt = await attemptModel.findById(attemptId);
  const replayed = Boolean(attempt && attempt.attemptNo !== attemptNo);
  return { replayed, session: await buildSession(attempt) };
}

/* ------------------------------ 恢复 / 取题 / 计时 ------------------------------ */

async function recoverAttempt(attemptId, user) {
  const attempt = await attemptModel.findById(attemptId);
  assertOwner(attempt, user);
  const includeQuestions = attempt.status === 'ongoing';
  return buildSession(attempt, { includeQuestions });
}

async function getAttemptQuestions(attemptId, user) {
  const attempt = await attemptModel.findById(attemptId);
  assertOwner(attempt, user);
  if (attempt.status !== 'ongoing') throw fail(40109);
  const remaining = await attemptModel.remainingSeconds(attemptId);
  if (remaining && remaining.isExpired) throw fail(40109, { message: '答卷已超时，禁止继续取题' });
  const rows = await attemptModel.listAttemptQuestions(attemptId);
  return {
    attemptId: attempt.id,
    remainingSeconds: remaining ? remaining.remainingSeconds : 0,
    serverTime: new Date().toISOString(),
    questions: rows.map(projectAttemptQuestion),
  };
}

async function getRemainingTime(attemptId, user) {
  const attempt = await attemptModel.findById(attemptId);
  assertOwner(attempt, user);
  const remaining = await attemptModel.remainingSeconds(attemptId);
  return {
    attemptId: attempt.id,
    remainingSeconds: remaining ? remaining.remainingSeconds : 0,
    serverTime: new Date().toISOString(),
    deadlineAt: attempt.deadlineAt,
    shouldAutoSubmit: Boolean(remaining && remaining.remainingSeconds === 0 && attempt.autoSubmitOnTimeout && attempt.status === 'ongoing'),
  };
}

/* ------------------------------ 答案暂存 ------------------------------ */

function normalizeAnswer(answer) {
  if (answer === null || answer === undefined) return null;
  const arr = Array.isArray(answer) ? answer : [answer];
  return arr.map((item) => String(item));
}

async function saveAnswers(attemptId, { answers }, user) {
  const attempt = await attemptModel.findById(attemptId);
  assertOwner(attempt, user);
  if (attempt.status !== 'ongoing') throw fail(40109);
  const remaining = await attemptModel.remainingSeconds(attemptId);
  if (remaining && remaining.isExpired) throw fail(40109, { message: '答卷已超时，禁止继续暂存' });

  const questions = await attemptModel.listAttemptQuestions(attemptId);
  const questionMap = new Map(questions.map((question) => [question.questionId, question]));
  const normalized = [];
  for (const item of answers) {
    const questionId = Number(item.questionId);
    const question = questionMap.get(questionId);
    if (!question) throw fail(90101, { errors: [{ field: 'answers.questionId', message: `题目 ${questionId} 不属于本答卷` }] });
    if (item.answerVersion !== undefined && item.answerVersion !== null
      && Number(item.answerVersion) !== Number(question.answerVersion)) {
      throw fail(90409, { data: { questionId, currentVersion: question.answerVersion } });
    }
    normalized.push({ questionId, answer: normalizeAnswer(item.answer), answerVersion: item.answerVersion });
  }

  await db.withTransaction(async (conn) => {
    for (const item of normalized) {
      const affected = await attemptModel.saveAnswer(
        attemptId,
        item.questionId,
        item.answer === null ? null : JSON.stringify(item.answer),
        item.answerVersion,
        conn,
      );
      if (affected === 0) {
        // 可能被并发更新，读取最新版本返回给前端重新拉取
        const latest = await attemptModel.findAttemptQuestion(attemptId, item.questionId);
        throw fail(90409, { data: { questionId: item.questionId, currentVersion: latest ? latest.answerVersion : null } });
      }
    }
    await auditModel.write({
      userId: user.id,
      module: 'exm',
      action: 'attempt.answer',
      requestSummary: { attemptId, count: normalized.length },
      result: 'success',
    }, conn);
  });

  const latestRemaining = await attemptModel.remainingSeconds(attemptId);
  return {
    savedAt: new Date().toISOString(),
    savedCount: normalized.length,
    remainingSeconds: latestRemaining ? latestRemaining.remainingSeconds : 0,
  };
}

/* ------------------------------ 防作弊 ------------------------------ */

async function reportAntiCheatEvent(attemptId, payload, user, { ip }) {
  const attempt = await attemptModel.findById(attemptId);
  assertOwner(attempt, user);
  if (!ANTI_CHEAT_EVENTS.includes(payload.eventType)) throw fail(90101, { errors: [{ field: 'eventType', message: '事件类型不合法' }] });
  if (attempt.status !== 'ongoing') throw fail(40109);

  const exam = await examModel.findExamById(attempt.examId);
  await attemptModel.addAntiCheatEvent({
    attemptId,
    examId: attempt.examId,
    studentId: attempt.studentId,
    eventType: payload.eventType,
    detail: payload.detail,
    ip,
    userAgent: null,
  });

  const cumulativeCount = await attemptModel.cumulativeEventCount(attemptId, payload.eventType);
  const total = await attemptModel.totalEventCount(attemptId);
  let isAbnormal = attempt.isAbnormal;
  if (exam && exam.antiCheatEnabled && total >= exam.antiCheatThreshold) {
    const reason = `防作弊事件累计 ${total} 次，超过阈值 ${exam.antiCheatThreshold}`;
    await attemptModel.markAbnormal(attemptId, reason);
    isAbnormal = true;
    await systemModel.createNotifications([{
      userId: exam.ownerId,
      title: `考试异常提醒：${exam.examName}`,
      content: `考生 ${attempt.studentName} 触发防作弊阈值：${reason}`,
      noticeType: 'exam_change',
      bizType: 'exam',
      bizId: exam.id,
    }]);
  }

  return { cumulativeCount, isAbnormal };
}

/* ------------------------------ 交卷（幂等） ------------------------------ */

function buildSubmitResult(attempt, tasks, replayed) {
  const pending = tasks.filter((task) => task.status !== 'done');
  return {
    attemptId: attempt.id,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    submitType: attempt.submitType,
    objectiveScore: attempt.objectiveScore,
    subjectiveScore: attempt.subjectiveScore,
    totalScore: attempt.totalScore,
    passScore: attempt.passScore,
    isPassed: attempt.isPassed,
    gradingStatus: attempt.gradingStatus,
    gradingTaskId: pending.length > 0 ? pending[0].taskId : null,
    pendingManualCount: pending.length,
    replayed,
  };
}

async function submitInternal(attemptId, submitType, user, { ip } = {}) {
  const before = await attemptModel.findById(attemptId);
  if (!before) throw fail(40114);
  if (user) assertOwner(before, user);

  const outcome = await db.withTransaction(async (conn) => {
    const affected = await attemptModel.conditionalSubmit(attemptId, submitType, conn);
    if (affected === 0) return { first: false };
    await gradingModel.createTasksForSubjective(attemptId, before.examId, conn);
    await examModel.markTaskSubmitted(before.examId, before.studentId, conn);
    await gradingService.autoGrade(attemptId, { conn });
    await auditModel.write({
      userId: user ? user.id : before.studentId,
      module: 'exm',
      action: 'attempt.submit',
      ip,
      requestSummary: { attemptId, submitType },
      result: 'success',
    }, conn);
    return { first: true };
  });

  const attempt = await attemptModel.findById(attemptId);
  const tasks = await gradingModel.listTasksByAttempt(attemptId);
  const result = buildSubmitResult(attempt, tasks, !outcome.first);

  if (outcome.first) {
    // 判分完成后刷新物化统计（失败不影响交卷响应）
    gradeService.refreshExamMaterialized(before.examId).catch(() => {});
  }
  return result;
}

async function submitAttempt(attemptId, { submitType = 'manual' } = {}, user, context = {}) {
  const attempt = await attemptModel.findById(attemptId);
  if (!attempt) throw fail(40114);
  if (user) assertOwner(attempt, user);
  // 服务端判定是否超时：超过 deadline + 5s 宽限一律按 timeout 处理，不采信客户端声明
  const beyondGrace = Date.now() > new Date(attempt.deadlineAt).getTime() + GRACE_MS;
  const effectiveType = submitType === 'timeout' || beyondGrace ? 'timeout' : 'manual';
  return submitInternal(attemptId, effectiveType, user, context);
}

/** 定时任务调用：超时自动交卷 */
async function autoSubmitExpired() {
  const expired = await attemptModel.listExpiredOngoing(50);
  const results = [];
  for (const item of expired) {
    try {
      const result = await submitInternal(item.id, 'timeout', null, {});
      results.push({ attemptId: item.id, status: result.status });
    } catch (err) {
      results.push({ attemptId: item.id, error: err.message });
    }
  }
  return results;
}

/** 管理员触发/重放自动判分 */
async function gradeAttempt(attemptId, user) {
  const attempt = await attemptModel.findById(attemptId);
  if (!attempt) throw fail(40114);
  if (attempt.status === 'ongoing') throw fail(40109, { message: '答卷尚未交卷，不能判分' });
  return db.withTransaction(async (conn) => {
    await gradingModel.createTasksForSubjective(attemptId, attempt.examId, conn);
    const result = await gradingService.autoGrade(attemptId, { conn });
    await auditModel.write({
      userId: user.id,
      module: 'exm',
      action: 'attempt.grade',
      requestSummary: { attemptId, examId: attempt.examId },
      result: 'success',
    }, conn);
    return result;
  });
}

module.exports = {
  startAttempt,
  recoverAttempt,
  getAttemptQuestions,
  getRemainingTime,
  saveAnswers,
  reportAntiCheatEvent,
  submitAttempt,
  autoSubmitExpired,
  gradeAttempt,
  buildSession,
  parseAnswer: (value) => parseJson(value, null),
};