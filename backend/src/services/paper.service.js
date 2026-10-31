'use strict';

/** 试卷与组卷服务：手动组卷、随机组卷、分值校验、预览脱敏、复制、锁定归档 */
const paperModel = require('../models/paper.model');
const questionModel = require('../models/question.model');
const examModel = require('../models/exam.model');
const auditModel = require('../models/audit.model');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { parsePagination, pageResult } = require('../utils/pagination');
const { projectPaperQuestion } = require('../utils/mask');
const { QUESTION_TYPES, PAPER_STATUS } = require('../config/constants');

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function assertAccess(paper, user) {
  if (!paper) throw fail(90401);
  if (user.roleCode === 'admin') return;
  if (Number(paper.ownerId) !== Number(user.id)) throw fail(90302);
}

function assertEditable(paper) {
  if (paper.status === 'locked') throw fail(30103);
  if (paper.status === 'archived') throw fail(30104);
  if (paper.status === 'deleted') throw fail(90401);
}

function validateScoreSum(totalScore, items) {
  const actualSum = round2(items.reduce((sum, item) => sum + Number(item.score), 0));
  const expected = round2(totalScore);
  if (Math.abs(actualSum - expected) > 0.001) {
    throw fail(30101, {
      data: { expectedTotal: expected, actualSum, difference: round2(expected - actualSum) },
    });
  }
}

async function assertQuestionsUsable(items, user) {
  if (!items || items.length === 0) throw fail(30102);
  const ids = items.map((item) => Number(item.questionId));
  if (new Set(ids).size !== ids.length) throw fail(30105);
  const questions = await questionModel.findQuestionsByIds(ids);
  if (questions.length !== ids.length) throw fail(30108, { message: '部分题目不存在或已删除' });
  const bankChecks = new Map();
  for (const question of questions) {
    if (question.status === 'archived') throw fail(30108, { message: `题目 ${question.questionNo} 已归档` });
    if (!bankChecks.has(question.bankId)) {
      const bank = await questionModel.findBankById(question.bankId);
      await require('./question.service').assertBankAccess(bank, user, false);
      bankChecks.set(question.bankId, true);
    }
  }
  return questions;
}

async function buildDetail(paperId, user) {
  const paper = await paperModel.findPaperById(paperId);
  if (!paper) throw fail(90401);
  assertAccess(paper, user);
  const rows = await paperModel.listPaperQuestions(paperId);
  const questions = rows.map(projectPaperQuestion);
  const actualSum = round2(questions.reduce((sum, item) => sum + item.score, 0));
  return {
    ...paper,
    questions,
    scoreCheck: {
      expectedTotal: paper.totalScore,
      actualSum,
      matched: Math.abs(actualSum - paper.totalScore) <= 0.001,
      difference: round2(paper.totalScore - actualSum),
    },
  };
}

/* ------------------------------ 查询 ------------------------------ */

async function listPapers(query, user) {
  const pagination = parsePagination(query);
  const filters = {
    keyword: query.keyword,
    status: query.status,
    examId: query.examId ? Number(query.examId) : null,
  };
  const [list, total] = await Promise.all([
    paperModel.listPapers(filters, user, pagination),
    paperModel.countPapers(filters, user),
  ]);
  return pageResult(list, total, pagination);
}

async function getPaper(paperId, user) {
  return buildDetail(paperId, user);
}

async function previewPaper(paperId, user) {
  const detail = await buildDetail(paperId, user);
  return {
    paperId: detail.id,
    paperName: detail.paperName,
    totalScore: detail.totalScore,
    durationMinutes: detail.durationMinutes,
    questions: detail.questions,
  };
}

/* ------------------------------ 手动组卷 ------------------------------ */

async function createPaperInTransaction(conn, payload, user, assemblyMode = 'manual') {
  const paperNo = await paperModel.generatePaperNo();
  const paperId = await paperModel.createPaper({
    paperNo,
    paperName: payload.paperName,
    ownerId: user.id,
    assemblyMode,
    totalScore: round2(payload.totalScore),
    questionCount: payload.items.length,
    durationMinutes: payload.durationMinutes,
    status: 'draft',
    description: payload.description,
    createdBy: user.id,
  }, conn);

  for (let index = 0; index < payload.items.length; index += 1) {
    const item = payload.items[index];
    await paperModel.insertPaperQuestion(paperId, {
      questionId: item.question.id,
      sectionNo: item.sectionNo || 1,
      orderNo: item.orderNo || index + 1,
      score: round2(item.score),
      snapshot: require('./question.service').buildSnapshot(item.question),
    }, conn);
  }
  for (const item of payload.items) {
    await questionModel.incrementReferenceCount(item.question.id, 1, conn);
  }
  return paperId;
}

async function createPaper(payload, user) {
  validateScoreSum(payload.totalScore, payload.questions);
  const questions = await assertQuestionsUsable(payload.questions, user);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const items = payload.questions.map((item) => ({
    question: questionMap.get(Number(item.questionId)),
    score: Number(item.score),
    sectionNo: item.sectionNo || 1,
    orderNo: item.orderNo || null,
  }));
  // 未显式给 orderNo 时按数组顺序编号
  items.forEach((item, index) => {
    if (!item.orderNo) item.orderNo = index + 1;
  });
  if (new Set(items.map((item) => item.orderNo)).size !== items.length) {
    throw fail(30105, { message: '题目顺序号不能重复' });
  }

  const paperId = await db.withTransaction(async (conn) => {
    const id = await createPaperInTransaction(conn, {
      paperName: payload.paperName,
      description: payload.description,
      totalScore: payload.totalScore,
      durationMinutes: payload.durationMinutes,
      items,
    }, user, 'manual');
    await auditModel.write({
      userId: user.id,
      module: 'ppm',
      action: 'paper.create',
      requestSummary: { paperId: id, questionCount: items.length, totalScore: payload.totalScore },
      result: 'success',
    }, conn);
    return id;
  });
  return buildDetail(paperId, user);
}

/* ------------------------------ 随机组卷 ------------------------------ */

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function splitByDistribution(count, distribution) {
  if (!distribution) return [{ difficulty: null, count }];
  const entries = Object.entries(distribution)
    .map(([difficulty, ratio]) => ({ difficulty: Number(difficulty), ratio: Number(ratio) }))
    .filter((item) => item.ratio > 0)
    .sort((a, b) => a.difficulty - b.difficulty);
  const totalRatio = entries.reduce((sum, item) => sum + item.ratio, 0);
  let assigned = 0;
  const buckets = entries.map((item, index) => {
    const isLast = index === entries.length - 1;
    const qty = isLast ? count - assigned : Math.max(0, Math.round((item.ratio / totalRatio) * count));
    assigned += qty;
    return { difficulty: item.difficulty, count: qty };
  });
  // 修正取整误差
  let diff = count - buckets.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  while (diff > 0) {
    buckets[cursor % buckets.length].count += 1;
    cursor += 1;
    diff -= 1;
  }
  while (diff < 0) {
    const bucket = buckets.find((item) => item.count > 0);
    if (!bucket) break;
    bucket.count -= 1;
    diff += 1;
  }
  return buckets.filter((item) => item.count > 0);
}

async function randomAssemblePaper(payload, user) {
  if (!Array.isArray(payload.rules) || payload.rules.length === 0) throw fail(90101, { errors: [{ field: 'rules', message: '抽题规则不能为空' }] });
  let expectedTotal = 0;
  for (const rule of payload.rules) {
    if (!QUESTION_TYPES.includes(rule.questionType)) throw fail(20101);
    if (!(Number(rule.count) > 0) || !(Number(rule.scorePerQuestion) > 0)) throw fail(90101, { message: '抽题数量与单题分值必须大于 0' });
    if (rule.difficultyDistribution) {
      const sum = Object.values(rule.difficultyDistribution).reduce((acc, value) => acc + Number(value), 0);
      if (Math.abs(sum - 1) > 0.001) throw fail(90101, { message: '难度占比之和必须为 1' });
      for (const key of Object.keys(rule.difficultyDistribution)) {
        if (![1, 2, 3, 4, 5].includes(Number(key))) throw fail(90101, { message: '难度取值必须为 1~5' });
      }
    }
    expectedTotal += Number(rule.count) * Number(rule.scorePerQuestion);
  }
  if (Math.abs(round2(expectedTotal) - round2(payload.totalScore)) > 0.001) {
    throw fail(30101, { data: { expectedTotal: round2(payload.totalScore), actualSum: round2(expectedTotal), difference: round2(payload.totalScore - expectedTotal) } });
  }

  const selectedIds = new Set();
  const selectedQuestions = [];
  const shortages = [];
  const bankIds = payload.bankIds || [];
  const knowledgePointIds = payload.knowledgePointIds || [];

  for (const rule of payload.rules) {
    const buckets = splitByDistribution(Number(rule.count), rule.difficultyDistribution);
    for (const bucket of buckets) {
      let candidates = await questionModel.findRandomCandidates({
        bankIds,
        knowledgePointIds,
        questionType: rule.questionType,
        difficulties: bucket.difficulty ? [bucket.difficulty] : null,
        scopeUser: user,
      });
      candidates = candidates.filter((question) => !selectedIds.has(question.id));
      const availableCount = candidates.length;
      if (availableCount < bucket.count) {
        shortages.push({
          dimension: bucket.difficulty ? 'difficulty' : 'questionType',
          questionType: rule.questionType,
          difficulty: bucket.difficulty || null,
          knowledgePointId: null,
          requiredCount: bucket.count,
          availableCount,
          shortageCount: bucket.count - availableCount,
        });
        continue;
      }
      const picked = shuffle(candidates).slice(0, bucket.count);
      picked.forEach((question) => {
        selectedIds.add(question.id);
        selectedQuestions.push({ question, score: Number(rule.scorePerQuestion) });
      });
    }
  }

  if (shortages.length > 0) {
    throw fail(30107, { data: { shortages } });
  }

  const requiredTotal = payload.rules.reduce((sum, rule) => sum + Number(rule.count), 0);
  if (selectedQuestions.length !== requiredTotal) {
    throw fail(30107, { data: { shortages } });
  }

  const items = selectedQuestions.map((item, index) => ({
    ...item,
    sectionNo: 1,
    orderNo: index + 1,
  }));

  if (payload.saveDraft === false) {
    return {
      paperId: null,
      paperName: payload.paperName,
      totalScore: round2(payload.totalScore),
      questionCount: items.length,
      questions: items.map((item, index) => ({
        paperQuestionId: null,
        questionId: item.question.id,
        questionNo: item.question.questionNo,
        questionType: item.question.questionType,
        difficulty: item.question.difficulty,
        stem: item.question.stem,
        options: item.question.options,
        knowledgePointId: item.question.knowledgePointId,
        sectionNo: item.sectionNo,
        orderNo: index + 1,
        score: round2(item.score),
      })),
      shortages: [],
    };
  }

  const paperId = await db.withTransaction(async (conn) => {
    const id = await createPaperInTransaction(conn, {
      paperName: payload.paperName,
      description: payload.description,
      totalScore: payload.totalScore,
      durationMinutes: payload.durationMinutes,
      items,
    }, user, 'random');
    await auditModel.write({
      userId: user.id,
      module: 'ppm',
      action: 'paper.random',
      requestSummary: { paperId: id, rules: payload.rules },
      result: 'success',
    }, conn);
    return id;
  });

  const detail = await buildDetail(paperId, user);
  return {
    paperId: detail.id,
    paperName: detail.paperName,
    totalScore: detail.totalScore,
    questionCount: detail.questionCount,
    questions: detail.questions,
    shortages: [],
  };
}

/* ------------------------------ 编辑 ------------------------------ */

async function updatePaper(paperId, payload, user) {
  const paper = await paperModel.findPaperById(paperId);
  assertAccess(paper, user);
  if (paper.status === 'locked' || paper.status === 'archived') {
    const changingStructure = payload.totalScore !== undefined || payload.durationMinutes !== undefined;
    if (changingStructure) throw fail(30103);
  }
  const sum = await paperModel.sumPaperScore(paperId);
  const totalScore = payload.totalScore === undefined ? paper.totalScore : payload.totalScore;
  if (Math.abs(round2(totalScore) - round2(sum.sum)) > 0.001) {
    throw fail(30101, { data: { expectedTotal: round2(totalScore), actualSum: sum.sum, difference: round2(totalScore - sum.sum) } });
  }
  await paperModel.updatePaper(paperId, {
    paperName: payload.paperName || paper.paperName,
    description: payload.description === undefined ? paper.description : payload.description,
    totalScore,
    durationMinutes: payload.durationMinutes || paper.durationMinutes,
    questionCount: sum.count,
    status: paper.status,
  });
  await auditModel.write({
    userId: user.id,
    module: 'ppm',
    action: 'paper.update',
    requestSummary: { paperId, fields: Object.keys(payload) },
    result: 'success',
  });
  return null;
}

async function deletePaper(paperId, user) {
  const paper = await paperModel.findPaperById(paperId);
  assertAccess(paper, user);
  const examCount = await paperModel.countPaperExams(paperId);
  if (examCount > 0 || paper.usedCount > 0) throw fail(30106, { data: { examCount } });
  await paperModel.softDeletePaper(paperId);
  await auditModel.write({
    userId: user.id,
    module: 'ppm',
    action: 'paper.delete',
    requestSummary: { paperId },
    result: 'success',
  });
  return null;
}

async function addPaperQuestions(paperId, { questions }, user) {
  const paper = await paperModel.findPaperById(paperId);
  assertAccess(paper, user);
  assertEditable(paper);
  const usable = await assertQuestionsUsable(questions, user);
  const questionMap = new Map(usable.map((question) => [question.id, question]));
  const existing = await paperModel.listPaperQuestions(paperId);
  const existingIds = new Set(existing.map((item) => item.questionId));
  if (questions.some((item) => existingIds.has(Number(item.questionId)))) throw fail(30105);
  let maxOrder = existing.reduce((max, item) => Math.max(max, item.orderNo), 0);
  const items = questions.map((item) => {
    maxOrder += 1;
    return {
      question: questionMap.get(Number(item.questionId)),
      score: Number(item.score),
      sectionNo: item.sectionNo || 1,
      orderNo: item.orderNo || maxOrder,
    };
  });
  if (new Set([...existing.map((item) => item.orderNo), ...items.map((item) => item.orderNo)]).size
    !== existing.length + items.length) {
    throw fail(30105, { message: '题目顺序号不能重复' });
  }
  const newTotal = round2(existing.reduce((sum, item) => sum + item.score, 0) + items.reduce((sum, item) => sum + item.score, 0));

  await db.withTransaction(async (conn) => {
    for (const item of items) {
      await paperModel.insertPaperQuestion(paperId, {
        questionId: item.question.id,
        sectionNo: item.sectionNo,
        orderNo: item.orderNo,
        score: round2(item.score),
        snapshot: require('./question.service').buildSnapshot(item.question),
      }, conn);
      await questionModel.incrementReferenceCount(item.question.id, 1, conn);
    }
    await paperModel.updatePaper(paperId, {
      paperName: paper.paperName,
      description: paper.description,
      totalScore: newTotal,
      durationMinutes: paper.durationMinutes,
      questionCount: existing.length + items.length,
      status: paper.status,
    }, conn);
    await auditModel.write({
      userId: user.id,
      module: 'ppm',
      action: 'paper.addQuestions',
      requestSummary: { paperId, addedCount: items.length, newTotal },
      result: 'success',
    }, conn);
  });
  return buildDetail(paperId, user);
}

async function updatePaperQuestions(paperId, { questions }, user) {
  const paper = await paperModel.findPaperById(paperId);
  assertAccess(paper, user);
  assertEditable(paper);
  const existing = await paperModel.listPaperQuestions(paperId);
  const existingMap = new Map(existing.map((item) => [item.paperQuestionId, item]));
  if (questions.length !== existing.length || questions.some((item) => !existingMap.has(Number(item.paperQuestionId)))) {
    throw fail(90101, { message: '必须提交试卷内全部题目的顺序与分值' });
  }
  if (new Set(questions.map((item) => Number(item.orderNo))).size !== questions.length) {
    throw fail(30105, { message: '题目顺序号不能重复' });
  }
  const sum = round2(questions.reduce((acc, item) => acc + Number(item.score), 0));
  if (Math.abs(sum - paper.totalScore) > 0.001) {
    throw fail(30101, { data: { expectedTotal: paper.totalScore, actualSum: sum, difference: round2(paper.totalScore - sum) } });
  }
  await db.withTransaction(async (conn) => {
    for (const item of questions) {
      await paperModel.updatePaperQuestion(paperId, item.paperQuestionId, {
        score: round2(item.score),
        orderNo: item.orderNo,
        sectionNo: item.sectionNo,
      }, conn);
    }
    await auditModel.write({
      userId: user.id,
      module: 'ppm',
      action: 'paper.updateQuestions',
      requestSummary: { paperId, count: questions.length },
      result: 'success',
    }, conn);
  });
  return buildDetail(paperId, user);
}

async function removePaperQuestion(paperId, paperQuestionId, user) {
  const paper = await paperModel.findPaperById(paperId);
  assertAccess(paper, user);
  assertEditable(paper);
  const paperQuestion = await paperModel.findPaperQuestion(paperId, paperQuestionId);
  if (!paperQuestion) throw fail(90401);
  const sum = await paperModel.sumPaperScore(paperId);
  if (sum.count <= 1) throw fail(30102, { message: '试卷至少需要保留 1 道题' });
  try {
    await db.withTransaction(async (conn) => {
      await paperModel.deletePaperQuestion(paperId, paperQuestionId);
      await questionModel.incrementReferenceCount(paperQuestion.questionId, -1, conn);
      await paperModel.updatePaper(paperId, {
        paperName: paper.paperName,
        description: paper.description,
        totalScore: round2(sum.sum - paperQuestion.score),
        durationMinutes: paper.durationMinutes,
        questionCount: sum.count - 1,
        status: paper.status,
      }, conn);
      await auditModel.write({
        userId: user.id,
        module: 'ppm',
        action: 'paper.removeQuestion',
        requestSummary: { paperId, paperQuestionId },
        result: 'success',
      }, conn);
    });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') throw fail(90409, { message: '该题已被答卷引用，无法从试卷移除' });
    throw err;
  }
  return null;
}

async function copyPaper(paperId, { paperName }, user) {
  const source = await paperModel.findPaperById(paperId);
  assertAccess(source, user);
  const rows = await paperModel.listPaperQuestions(paperId);
  if (rows.length === 0) throw fail(30102);
  const questionIds = rows.map((row) => row.questionId);
  const questions = await questionModel.findQuestionsByIds(questionIds);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  if (questionMap.size !== rows.length) throw fail(30108, { message: '原试卷存在已删除题目，无法复制' });

  const newPaperId = await db.withTransaction(async (conn) => {
    const paperNo = await paperModel.generatePaperNo();
    const id = await paperModel.createPaper({
      paperNo,
      paperName,
      ownerId: user.id,
      assemblyMode: source.assemblyMode,
      totalScore: source.totalScore,
      questionCount: rows.length,
      durationMinutes: source.durationMinutes,
      status: 'draft',
      description: source.description,
      createdBy: user.id,
    }, conn);
    for (const row of rows) {
      const question = questionMap.get(row.questionId);
      await paperModel.insertPaperQuestion(id, {
        questionId: question.id,
        sectionNo: row.sectionNo,
        orderNo: row.orderNo,
        score: row.score,
        snapshot: require('./question.service').buildSnapshot(question),
      }, conn);
      await questionModel.incrementReferenceCount(question.id, 1, conn);
    }
    await auditModel.write({
      userId: user.id,
      module: 'ppm',
      action: 'paper.copy',
      requestSummary: { sourcePaperId: paperId, newPaperId: id, paperName },
      result: 'success',
    }, conn);
    return id;
  });
  return buildDetail(newPaperId, user);
}

async function updatePaperStatus(paperId, { status }, user) {
  const paper = await paperModel.findPaperById(paperId);
  assertAccess(paper, user);
  if (!PAPER_STATUS.includes(status)) throw fail(90101, { errors: [{ field: 'status', message: '状态不合法' }] });
  if (status === 'archived' && user.roleCode !== 'admin') throw fail(90301);
  const sum = await paperModel.sumPaperScore(paperId);
  if (status === 'published' && (sum.count === 0 || Math.abs(sum.sum - paper.totalScore) > 0.001)) {
    throw fail(30101, { data: { expectedTotal: paper.totalScore, actualSum: sum.sum, difference: round2(paper.totalScore - sum.sum) } });
  }
  await paperModel.updatePaperStatus(paperId, status);
  await auditModel.write({
    userId: user.id,
    module: 'ppm',
    action: 'paper.status',
    requestSummary: { paperId, fromStatus: paper.status, toStatus: status },
    result: 'success',
  });
  return null;
}

module.exports = {
  listPapers,
  getPaper,
  previewPaper,
  createPaper,
  randomAssemblePaper,
  updatePaper,
  deletePaper,
  addPaperQuestions,
  updatePaperQuestions,
  removePaperQuestion,
  copyPaper,
  updatePaperStatus,
};