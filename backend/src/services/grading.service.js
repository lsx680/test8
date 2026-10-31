'use strict';

/**
 * 阅卷与复核服务：客观题自动判分（可重放）、人工评分、双评仲裁、阅卷进度、标准答案重判
 * 依据：设计文档 §3.6
 */
const attemptModel = require('../models/attempt.model');
const gradingModel = require('../models/grading.model');
const questionModel = require('../models/question.model');
const examModel = require('../models/exam.model');
const configService = require('./config.service');
const auditModel = require('../models/audit.model');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { parsePagination, pageResult } = require('../utils/pagination');
const { gradeQuestion } = require('../utils/answering/grader');
const { OBJECTIVE_TYPES } = require('../config/constants');
const { validateQuestionPayload } = require('../validators/question.validator');

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function assertTaskAccess(task, user) {
  if (!task) throw fail(90401);
  if (user.roleCode === 'admin') return;
  if (Number(task.examOwnerId) !== Number(user.id)) throw fail(90302);
}

/**
 * 自动判分：先清零再按快照重算（可重放，结果一致），主观题人工分保持不变
 * @param {number} attemptId
 * @param {{conn?: object}} options 传入 conn 则参与外层事务
 */
async function autoGrade(attemptId, { conn = null } = {}) {
  const run = async (tx) => {
    const attempt = await attemptModel.findById(attemptId, { conn: tx });
    if (!attempt) throw fail(40114);
    const questions = await attemptModel.listAttemptQuestions(attemptId, tx);
    if (questions.length === 0) throw fail(90409, { message: '答卷没有题目快照，无法判分' });
    const strategy = (await configService.get('grading.multiChoiceStrategy')) || 'all_or_nothing';

    await attemptModel.resetObjectiveScores(attemptId, tx);
    for (const question of questions) {
      if (!OBJECTIVE_TYPES.includes(question.questionType)) continue;
      const snapshot = question.snapshot || {};
      const result = gradeQuestion({
        questionType: question.questionType,
        correctAnswer: snapshot.correctAnswer,
        studentAnswer: question.studentAnswer,
        fullScore: question.fullScore,
        strategy,
      });
      await attemptModel.updateObjectiveScore(question.id, {
        autoScore: result.autoScore,
        finalScore: result.autoScore,
        isCorrect: result.isCorrect,
        gradeStatus: 'auto',
      }, tx);
    }

    // 主观题：保持既有 manual_score，未评分按 0 计；不覆盖人工评分时间与评语
    await attemptModel.syncSubjectiveFinal(attemptId, tx);

    const sums = await attemptModel.sumScores(attemptId, tx);
    const taskCount = await gradingModel.countTasksByAttempt(attemptId, tx);
    const hasPending = taskCount.pending > 0;
    // 重放判分不得回退已完成的判分状态（REQ-MRK-06 / NFR-18）
    const alreadyDone = attempt.gradingStatus === 'done';
    const gradingStatus = hasPending ? 'manual_pending' : (alreadyDone ? 'done' : 'auto_done');
    let status;
    if (hasPending) status = 'grading';
    else if (attempt.status === 'reviewed') status = 'reviewed';
    else status = 'graded';
    const isPassed = sums.total >= attempt.passScore ? 1 : 0;
    await attemptModel.updateAttemptTotals(attemptId, {
      objectiveScore: sums.objective,
      subjectiveScore: sums.subjective,
      totalScore: sums.total,
      isPassed,
      gradingStatus,
      status,
      conn: tx,
    });
    return {
      attemptId,
      attemptQuestionId: null,
      autoScore: sums.objective,
      manualScore: sums.subjective,
      finalScore: sums.total,
      objectiveScore: sums.objective,
      subjectiveScore: sums.subjective,
      totalScore: sums.total,
      isPassed: Boolean(isPassed),
      gradingStatus,
      gradedAt: new Date().toISOString(),
    };
  };

  return conn ? run(conn) : db.withTransaction(run);
}

/** 人工评分后重算答卷总分与状态 */
async function recomputeAttemptAfterManual(attemptId, conn, operatorId, changeLogEntry) {
  const attempt = await attemptModel.findById(attemptId, { conn });
  if (!attempt) throw fail(40114);
  const sums = await attemptModel.sumScores(attemptId, conn);
  const taskCount = await gradingModel.countTasksByAttempt(attemptId, conn);
  const hasPending = taskCount.pending > 0;
  const gradingStatus = hasPending ? 'manual_pending' : 'done';
  const status = hasPending ? 'grading' : 'graded';
  const isPassed = sums.total >= attempt.passScore ? 1 : 0;
  await attemptModel.updateAttemptTotals(attemptId, {
    objectiveScore: sums.objective,
    subjectiveScore: sums.subjective,
    totalScore: sums.total,
    isPassed,
    gradingStatus,
    status,
    conn,
  });
  if (changeLogEntry) {
    await gradingModel.logGradeChange({
      ...changeLogEntry,
      oldTotalScore: attempt.totalScore,
      newTotalScore: sums.total,
      operatorId,
    }, conn);
  }
  return {
    totalScore: sums.total,
    objectiveScore: sums.objective,
    subjectiveScore: sums.subjective,
    isPassed: Boolean(isPassed),
    gradingStatus,
  };
}

/* ------------------------------ 队列查询 ------------------------------ */

async function listGradingTasks(query, user) {
  const pagination = parsePagination(query);
  const filters = {
    examId: query.examId ? Number(query.examId) : null,
    status: query.status,
    assigneeId: query.assigneeId ? Number(query.assigneeId) : null,
  };
  const [list, total, pending] = await Promise.all([
    gradingModel.listTasks(filters, user, pagination),
    gradingModel.countTasks(filters, user),
    gradingModel.countPendingByExam(filters.examId || 0, user),
  ]);
  const extra = { pendingCount: filters.examId ? pending : total };
  return pageResult(list, total, pagination, extra);
}

async function getGradingTask(taskId, user) {
  const task = await gradingModel.findTaskById(taskId);
  assertTaskAccess(task, user);
  return task;
}

/* ------------------------------ 人工评分 ------------------------------ */

async function scoreGradingTask(taskId, payload, user) {
  const task = await gradingModel.findTaskById(taskId);
  assertTaskAccess(task, user);
  if (task.status === 'done') throw fail(50103);
  if (task.status === 'arbitration') throw fail(50105, { message: '该任务处于仲裁状态，请使用仲裁接口' });

  const score = round2(payload.score);
  if (score < 0 || score > task.fullScore) throw fail(50101, { data: { fullScore: task.fullScore } });
  if (Array.isArray(payload.scoringPointScores) && payload.scoringPointScores.length > 0) {
    const sum = round2(payload.scoringPointScores.reduce((acc, item) => acc + Number(item.score), 0));
    if (Math.abs(sum - score) > 0.001) throw fail(50102, { data: { score, scoringPointSum: sum } });
  }

  const isSecond = ['first_done', 'second_pending'].includes(task.status);
  if (isSecond && Number(task.assigneeId) === Number(user.id)) throw fail(50104);

  const ratio = await configService.getNumber('grading.arbitrationThresholdRatio');
  const threshold = round2(task.fullScore * ratio);

  return db.withTransaction(async (conn) => {
    let finalScore = score;
    let nextStatus = 'done';
    let scoreGap = null;

    if (isSecond) {
      scoreGap = round2(Math.abs(Number(task.firstScore || 0) - score));
      await gradingModel.updateSecondScore(taskId, {
        score,
        graderId: user.id,
        comment: payload.comment,
        scoreGap,
      }, conn);
      if (scoreGap > threshold) {
        nextStatus = 'arbitration';
        finalScore = round2((Number(task.firstScore || 0) + score) / 2);
        await gradingModel.updateTaskStatus(taskId, 'arbitration', conn);
      } else {
        finalScore = round2((Number(task.firstScore || 0) + score) / 2);
        await gradingModel.setTaskFinalScore(taskId, finalScore, 'done', user.id, conn);
      }
    } else {
      await gradingModel.updateFirstScore(taskId, {
        score,
        graderId: user.id,
        comment: payload.comment,
      }, conn);
      // 默认单评模式：第一评完成即结束；若需双评可由管理员将任务置为 first_done 后再评
      await gradingModel.setTaskFinalScore(taskId, score, 'done', user.id, conn);
      nextStatus = 'done';
    }

    await attemptModel.updateManualScore(task.attemptQuestionId, {
      manualScore: isSecond && nextStatus === 'arbitration' ? Number(task.firstScore || 0) : finalScore,
      finalScore: isSecond && nextStatus === 'arbitration' ? Number(task.firstScore || 0) : finalScore,
      gradeStatus: nextStatus === 'arbitration' ? 'arbitration' : 'manual',
      graderId: user.id,
      comment: payload.comment,
    }, conn);

    const totals = await recomputeAttemptAfterManual(task.attemptId, conn, user.id, {
      attemptId: task.attemptId,
      attemptQuestionId: task.attemptQuestionId,
      changeType: 'manual_grading',
      oldScore: task.finalScore,
      newScore: nextStatus === 'arbitration' ? Number(task.firstScore || 0) : finalScore,
      reason: payload.comment || '人工评分',
    });

    await auditModel.write({
      userId: user.id,
      module: 'mrk',
      action: 'grading.score',
      requestSummary: { taskId, score, scoreGap, status: nextStatus },
      result: 'success',
    }, conn);

    return {
      attemptId: task.attemptId,
      attemptQuestionId: task.attemptQuestionId,
      autoScore: 0,
      manualScore: nextStatus === 'arbitration' ? Number(task.firstScore || 0) : finalScore,
      finalScore: nextStatus === 'arbitration' ? Number(task.firstScore || 0) : finalScore,
      objectiveScore: totals.objectiveScore,
      subjectiveScore: totals.subjectiveScore,
      totalScore: totals.totalScore,
      isPassed: totals.isPassed,
      gradingStatus: totals.gradingStatus,
      gradedAt: new Date().toISOString(),
    };
  });
}

async function arbitrateGradingTask(taskId, { score, reason }, user) {
  const task = await gradingModel.findTaskById(taskId);
  assertTaskAccess(task, user);
  if (user.roleCode !== 'admin' && Number(task.examOwnerId) !== Number(user.id)) throw fail(90302);
  if (task.status === 'done') throw fail(50103);
  const finalScore = round2(score);
  if (finalScore < 0 || finalScore > task.fullScore) throw fail(50101, { data: { fullScore: task.fullScore } });
  if (task.status !== 'arbitration' && user.roleCode !== 'admin') throw fail(50105);

  return db.withTransaction(async (conn) => {
    const scoreGap = task.firstScore !== null && task.secondScore !== null
      ? round2(Math.abs(task.firstScore - task.secondScore))
      : null;
    await gradingModel.updateArbitration(taskId, {
      score: finalScore,
      arbitratorId: user.id,
      reason,
      scoreGap,
    }, conn);
    await attemptModel.updateManualScore(task.attemptQuestionId, {
      manualScore: finalScore,
      finalScore,
      gradeStatus: 'arbitration',
      graderId: user.id,
      comment: reason,
    }, conn);
    const totals = await recomputeAttemptAfterManual(task.attemptId, conn, user.id, {
      attemptId: task.attemptId,
      attemptQuestionId: task.attemptQuestionId,
      changeType: 'arbitration',
      oldScore: task.finalScore,
      newScore: finalScore,
      reason,
    });
    await auditModel.write({
      userId: user.id,
      module: 'mrk',
      action: 'grading.arbitrate',
      requestSummary: { taskId, score: finalScore, reason },
      result: 'success',
    }, conn);
    return {
      attemptId: task.attemptId,
      attemptQuestionId: task.attemptQuestionId,
      autoScore: 0,
      manualScore: finalScore,
      finalScore,
      objectiveScore: totals.objectiveScore,
      subjectiveScore: totals.subjectiveScore,
      totalScore: totals.totalScore,
      isPassed: totals.isPassed,
      gradingStatus: totals.gradingStatus,
      gradedAt: new Date().toISOString(),
    };
  });
}

async function getGradingProgress(examId, user) {
  const exam = await examModel.findExamById(examId);
  if (!exam) throw fail(90401);
  if (user.roleCode !== 'admin' && Number(exam.ownerId) !== Number(user.id)) throw fail(90302);
  const progress = await gradingModel.examProgress(examId, user);
  return {
    examId: Number(examId),
    ...progress,
    completionRate: progress.totalAttempts > 0
      ? Number(((progress.gradedAttempts / progress.totalAttempts) * 100).toFixed(2))
      : 0,
  };
}

/* ------------------------------ 答案修正重判 ------------------------------ */

async function rejudgeQuestion(questionId, payload, user) {
  if (user.roleCode !== 'admin') throw fail(90301);
  const question = await questionModel.findQuestionById(questionId);
  if (!question) throw fail(90401);
  if (question.questionType === 'short') throw fail(50106, { message: '主观题不支持自动重判' });
  if (question.status === 'archived') throw fail(50106, { message: '题目已归档，禁止重判' });
  validateQuestionPayload({
    questionType: question.questionType,
    options: question.options,
    correctAnswer: payload.correctAnswer,
    scoringPoints: question.scoringPoints,
    defaultScore: question.defaultScore,
  });

  const affected = await attemptModel.listAttemptsAffectedByQuestion(
    questionId,
    payload.scope === 'exam' ? Number(payload.examId) : null,
  );

  await db.withTransaction(async (conn) => {
    await questionModel.updateCorrectAnswer(questionId, payload.correctAnswer, conn);
    const updated = await questionModel.findQuestionById(questionId, conn);
    await questionModel.addVersion(questionId, updated.currentVersion, {
      ...require('./question.service').buildSnapshot(updated),
      correctAnswer: payload.correctAnswer,
    }, 'rejudge', payload.reason || '标准答案修正重判', user.id, conn);
    await auditModel.write({
      userId: user.id,
      module: 'mrk',
      action: 'question.rejudge',
      requestSummary: { questionId, scope: payload.scope || 'all', examId: payload.examId || null, reason: payload.reason },
      result: 'success',
    }, conn);
  });

  const strategy = (await configService.get('grading.multiChoiceStrategy')) || 'all_or_nothing';
  const changeLogIds = [];
  let scoreChangedAttempts = 0;
  let failedAttempts = 0;

  for (const item of affected) {
    try {
      const changed = await db.withTransaction(async (conn) => {
        const attempt = await attemptModel.findById(item.id, { conn });
        const aq = await attemptModel.findAttemptQuestion(item.id, questionId);
        if (!attempt || !aq) return false;
        const snapshot = { ...(aq.snapshot || {}), correctAnswer: payload.correctAnswer };
        await attemptModel.updateQuestionSnapshot(aq.id, snapshot, conn);
        const result = gradeQuestion({
          questionType: aq.questionType,
          correctAnswer: payload.correctAnswer,
          studentAnswer: aq.studentAnswer,
          fullScore: aq.fullScore,
          strategy,
        });
        await attemptModel.updateObjectiveScore(aq.id, {
          autoScore: result.autoScore,
          finalScore: result.autoScore,
          isCorrect: result.isCorrect,
          gradeStatus: 'auto',
        }, conn);
        const sums = await attemptModel.sumScores(item.id, conn);
        const isPassed = sums.total >= attempt.passScore ? 1 : 0;
        await attemptModel.updateAttemptTotals(item.id, {
          objectiveScore: sums.objective,
          subjectiveScore: sums.subjective,
          totalScore: sums.total,
          isPassed,
          gradingStatus: attempt.gradingStatus,
          status: attempt.status,
          conn,
        });
        const logId = await gradingModel.logGradeChange({
          attemptId: item.id,
          attemptQuestionId: aq.id,
          changeType: 'rejudge',
          oldScore: aq.finalScore,
          newScore: result.autoScore,
          oldTotalScore: attempt.totalScore,
          newTotalScore: sums.total,
          operatorId: user.id,
          reason: payload.reason || '标准答案修正重判',
        }, conn);
        changeLogIds.push(logId);
        return Math.abs(sums.total - attempt.totalScore) > 0.001;
      });
      if (changed) scoreChangedAttempts += 1;
    } catch (err) {
      failedAttempts += 1;
    }
  }

  return {
    questionId,
    affectedAttempts: affected.length,
    scoreChangedAttempts,
    failedAttempts,
    changeLogIds,
    finishedAt: new Date().toISOString(),
  };
}

module.exports = {
  autoGrade,
  recomputeAttemptAfterManual,
  listGradingTasks,
  getGradingTask,
  scoreGradingTask,
  arbitrateGradingTask,
  getGradingProgress,
  rejudgeQuestion,
};