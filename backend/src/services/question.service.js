'use strict';

/** 题库与题目服务：数据权限、题型校验、版本留痕、删除保护、批量导入导出 */
const questionModel = require('../models/question.model');
const knowledgeModel = require('../models/knowledge.model');
const auditModel = require('../models/audit.model');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { validateQuestionPayload } = require('../validators/question.validator');
const { parsePagination, pageResult } = require('../utils/pagination');

/** 题库访问判定：admin 全量；owner 读写；被授权教师按 can_write 限制写操作 */
async function assertBankAccess(bank, user, write = false) {
  if (!user || !bank) throw fail(90401);
  if (user.roleCode === 'admin') return;
  if (Number(bank.ownerId) === Number(user.id)) return;
  if (user.roleCode === 'teacher') {
    const auth = await questionModel.findBankAuthorization(bank.id, user.id);
    if (auth && (!write || auth.canWrite)) return;
  }
  throw fail(30108);
}

function buildSnapshot(question) {
  return {
    questionId: question.id,
    questionNo: question.questionNo,
    questionType: question.questionType,
    difficulty: question.difficulty,
    stem: question.stem,
    options: question.options,
    correctAnswer: question.correctAnswer,
    scoringPoints: question.scoringPoints,
    analysis: question.analysis,
    defaultScore: question.defaultScore,
    knowledgePointId: question.knowledgePointId,
  };
}

/* ------------------------------ 题库 ------------------------------ */

async function listBanks(query, user) {
  const pagination = parsePagination(query);
  const filters = { keyword: query.keyword };
  const [list, total] = await Promise.all([
    questionModel.listBanks(filters, user, pagination),
    questionModel.countBanks(filters, user),
  ]);
  return pageResult(list, total, pagination);
}

async function createBank(payload, user) {
  const duplicate = await questionModel.findBankByName(user.id, payload.bankName);
  if (duplicate) throw fail(20108);
  const year = new Date().getUTCFullYear();
  const bankCode = payload.bankCode || `BANK-${year}-${Date.now().toString().slice(-6)}`;
  const id = await questionModel.createBank({
    bankCode,
    bankName: payload.bankName,
    ownerId: user.id,
    description: payload.description,
    visibility: payload.visibility,
  });
  await auditModel.write({
    userId: user.id,
    module: 'qbm',
    action: 'bank.create',
    requestSummary: { bankId: id, bankName: payload.bankName },
    result: 'success',
  });
  return questionModel.findBankById(id);
}

async function updateBank(bankId, payload, user) {
  const bank = await questionModel.findBankById(bankId);
  if (!bank) throw fail(90401);
  if (user.roleCode !== 'admin' && Number(bank.ownerId) !== Number(user.id)) throw fail(30108);
  const duplicate = await questionModel.findBankByName(bank.ownerId, payload.bankName);
  if (duplicate && Number(duplicate.id) !== Number(bankId)) throw fail(20108);
  await questionModel.updateBank(bankId, {
    bankName: payload.bankName,
    bankCode: payload.bankCode || bank.bankCode,
    description: payload.description,
    visibility: payload.visibility || bank.visibility,
  });
  await auditModel.write({
    userId: user.id,
    module: 'qbm',
    action: 'bank.update',
    requestSummary: { bankId },
    result: 'success',
  });
  return questionModel.findBankById(bankId);
}

async function deleteBank(bankId, user) {
  const bank = await questionModel.findBankById(bankId);
  if (!bank) throw fail(90401);
  if (user.roleCode !== 'admin' && Number(bank.ownerId) !== Number(user.id)) throw fail(30108);
  const [questionCount, paperRefs] = await Promise.all([
    db.queryValue('SELECT COUNT(*) AS total FROM qb_question WHERE bank_id = ? AND deleted_at IS NULL', [bankId]),
    questionModel.countBankPaperReferences(bankId),
  ]);
  if (Number(questionCount) > 0 || Number(paperRefs) > 0) {
    throw fail(90409, {
      message: '题库内仍有题目或已被试卷引用，无法删除',
      data: { questionCount: Number(questionCount), referencedPaperCount: Number(paperRefs) },
    });
  }
  await questionModel.softDeleteBank(bankId);
  await auditModel.write({
    userId: user.id,
    module: 'qbm',
    action: 'bank.delete',
    requestSummary: { bankId },
    result: 'success',
  });
  return null;
}

async function authorizeBank(bankId, { granteeId, canWrite }, user) {
  const bank = await questionModel.findBankById(bankId);
  if (!bank) throw fail(90401);
  if (user.roleCode !== 'admin' && Number(bank.ownerId) !== Number(user.id)) throw fail(90302);
  const grantee = await require('../models/user.model').findById(granteeId);
  if (!grantee) throw fail(90401, { message: '被授权用户不存在' });
  if (grantee.roleCode !== 'teacher') throw fail(90101, { errors: [{ field: 'granteeId', message: '仅可授权给教师账号' }] });
  if (Number(granteeId) === Number(bank.ownerId)) throw fail(90101, { errors: [{ field: 'granteeId', message: '不能授权给题库所有者本人' }] });
  await questionModel.upsertBankAuthorization(bankId, granteeId, canWrite, user.id);
  await auditModel.write({
    userId: user.id,
    module: 'qbm',
    action: 'bank.authorize',
    requestSummary: { bankId, granteeId, canWrite: Boolean(canWrite) },
    result: 'success',
  });
  return null;
}

/* ------------------------------ 题目 ------------------------------ */

async function listQuestions(query, user) {
  const pagination = parsePagination(query);
  const filters = {
    keyword: query.keyword,
    bankId: query.bankId ? Number(query.bankId) : null,
    questionType: query.questionType,
    difficulty: query.difficulty ? Number(query.difficulty) : null,
    knowledgePointId: query.knowledgePointId ? Number(query.knowledgePointId) : null,
    createdBy: query.createdBy ? Number(query.createdBy) : null,
    status: query.status,
  };
  const [list, total] = await Promise.all([
    questionModel.listQuestions(filters, user, pagination),
    questionModel.countQuestions(filters, user),
  ]);
  return pageResult(list, total, pagination);
}

async function createQuestion(payload, user) {
  const bank = await questionModel.findBankById(payload.bankId);
  await assertBankAccess(bank, user, true);
  if (payload.knowledgePointId) {
    const kp = await knowledgeModel.findById(payload.knowledgePointId);
    if (!kp) throw fail(90401, { message: '知识点不存在' });
  }
  validateQuestionPayload(payload);

  return db.withTransaction(async (conn) => {
    const questionNo = payload.questionNo || (await questionModel.generateQuestionNo());
    const questionId = await questionModel.createQuestion({
      ...payload,
      questionNo,
      knowledgePointId: payload.knowledgePointId || null,
      difficulty: payload.difficulty || 3,
      status: payload.status || 'published',
      createdBy: user.id,
    }, conn);
    const question = await questionModel.findQuestionById(questionId, conn);
    await questionModel.addVersion(questionId, 1, buildSnapshot(question), 'create', '题目创建', user.id, conn);
    await questionModel.refreshBankQuestionCount(payload.bankId, conn);
    if (payload.knowledgePointId) await knowledgeModel.refreshQuestionCount(payload.knowledgePointId, conn);
    await auditModel.write({
      userId: user.id,
      module: 'qbm',
      action: 'question.create',
      requestSummary: { questionId, bankId: payload.bankId, questionType: payload.questionType },
      result: 'success',
    }, conn);
    return question;
  });
}

async function getQuestion(questionId, user) {
  const question = await questionModel.findQuestionById(questionId);
  if (!question) throw fail(90401);
  const bank = await questionModel.findBankById(question.bankId);
  await assertBankAccess(bank, user, false);
  return question;
}

async function updateQuestion(questionId, payload, user) {
  const existing = await questionModel.findQuestionById(questionId);
  if (!existing) throw fail(90401);
  const bank = await questionModel.findBankById(existing.bankId);
  await assertBankAccess(bank, user, true);
  if (payload.bankId && Number(payload.bankId) !== Number(existing.bankId)) {
    const targetBank = await questionModel.findBankById(payload.bankId);
    await assertBankAccess(targetBank, user, true);
  }
  if (payload.version !== undefined && Number(payload.version) !== Number(existing.currentVersion)) {
    throw fail(90409, { message: '题目已被他人修改，请刷新后重试' });
  }
  const merged = {
    bankId: payload.bankId || existing.bankId,
    knowledgePointId: payload.knowledgePointId === undefined ? existing.knowledgePointId : payload.knowledgePointId,
    questionType: payload.questionType || existing.questionType,
    difficulty: payload.difficulty || existing.difficulty,
    stem: payload.stem !== undefined ? payload.stem : existing.stem,
    options: payload.options !== undefined ? payload.options : existing.options,
    correctAnswer: payload.correctAnswer !== undefined ? payload.correctAnswer : existing.correctAnswer,
    scoringPoints: payload.scoringPoints !== undefined ? payload.scoringPoints : existing.scoringPoints,
    analysis: payload.analysis !== undefined ? payload.analysis : existing.analysis,
    defaultScore: payload.defaultScore !== undefined ? payload.defaultScore : existing.defaultScore,
    status: payload.status || existing.status,
    version: payload.version === undefined ? existing.currentVersion : payload.version,
  };
  validateQuestionPayload(merged);

  return db.withTransaction(async (conn) => {
    const affected = await questionModel.updateQuestion(questionId, merged, conn);
    if (affected === 0) throw fail(90409, { message: '题目已被他人修改，请刷新后重试' });
    const updated = await questionModel.findQuestionById(questionId, conn);
    await questionModel.addVersion(questionId, updated.currentVersion, buildSnapshot(updated), 'update', '题目编辑', user.id, conn);
    await questionModel.refreshBankQuestionCount(merged.bankId, conn);
    if (existing.bankId !== merged.bankId) await questionModel.refreshBankQuestionCount(existing.bankId, conn);
    if (existing.knowledgePointId) await knowledgeModel.refreshQuestionCount(existing.knowledgePointId, conn);
    if (merged.knowledgePointId) await knowledgeModel.refreshQuestionCount(merged.knowledgePointId, conn);
    await auditModel.write({
      userId: user.id,
      module: 'qbm',
      action: 'question.update',
      requestSummary: { questionId, version: updated.currentVersion },
      result: 'success',
    }, conn);
    return { questionId, version: updated.currentVersion };
  });
}

async function deleteQuestion(questionId, user) {
  const existing = await questionModel.findQuestionById(questionId);
  if (!existing) throw fail(90401);
  const bank = await questionModel.findBankById(existing.bankId);
  if (user.roleCode !== 'admin' && Number(bank.ownerId) !== Number(user.id)) {
    await assertBankAccess(bank, user, true);
  }
  const references = await questionModel.findQuestionReferences(questionId);
  if (references.papers.length > 0 || references.exams.length > 0) {
    throw fail(20106, { data: references });
  }
  await questionModel.softDeleteQuestion(questionId);
  await questionModel.refreshBankQuestionCount(existing.bankId);
  if (existing.knowledgePointId) await knowledgeModel.refreshQuestionCount(existing.knowledgePointId);
  await auditModel.write({
    userId: user.id,
    module: 'qbm',
    action: 'question.delete',
    requestSummary: { questionId },
    result: 'success',
  });
  return null;
}

async function listVersions(questionId, user) {
  await getQuestion(questionId, user);
  return questionModel.listVersions(questionId);
}

async function getReferences(questionId, user) {
  await getQuestion(questionId, user);
  return questionModel.findQuestionReferences(questionId);
}

/* ------------------------------ 批量导入 ------------------------------ */

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return undefined;
}

function parseJsonField(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw fail(90101, { message: `${field} 必须是合法 JSON` });
  }
}

/**
 * 批量导入：合法行入库，非法行返回 {rowNo, reason}（部分成功）
 * 依据：设计文档 §3.3.4
 */
async function importQuestions({ rows, bankId, knowledgePointId, defaultScore, user }) {
  if (rows.length > 5000) throw fail(20105);
  const bank = await questionModel.findBankById(bankId);
  await assertBankAccess(bank, user, true);

  const valid = [];
  const failures = [];
  const existingQuestionNos = new Set();
  let sequence = Number(await db.queryValue(
    'SELECT COUNT(*) AS total FROM qb_question WHERE question_no LIKE ?',
    [`Q-${new Date().getUTCFullYear()}-%`],
  ));

  rows.forEach((row, index) => {
    const rowNo = index + 2; // 表头占第 1 行
    try {
      const questionType = pick(row, ['questionType', '题型']);
      const stem = pick(row, ['stem', '题干']);
      const rawOptions = pick(row, ['options', '选项']);
      const rawAnswer = pick(row, ['correctAnswer', '正确答案', '答案']);
      const rawPoints = pick(row, ['scoringPoints', '采分点']);
      const difficulty = Number(pick(row, ['difficulty', '难度'])) || 3;
      const score = Number(pick(row, ['defaultScore', '分值'])) || Number(defaultScore) || 1;
      const kpIdRaw = pick(row, ['knowledgePointId', '知识点ID']);
      const status = pick(row, ['status', '状态']) || 'published';

      if (!questionType) throw fail(20101, { message: '题型不能为空' });
      if (!stem) throw fail(90101, { message: '题干不能为空' });
      if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5) throw fail(90101, { message: '难度必须为 1~5' });
      if (!(score > 0)) throw fail(90101, { message: '分值必须大于 0' });

      // 答案兼容 JSON 数组与 CSV 简化写法（判断题 true/false、填空题分号分隔、选择题逗号分隔）
      let correctAnswer = rawAnswer;
      // 空列必须归一为空数组，禁止 String(undefined) 产生 "undefined" 并被当作合法答案
      if (correctAnswer === undefined || correctAnswer === null
        || (typeof correctAnswer === 'string' && correctAnswer.trim() === '')) {
        correctAnswer = [];
      }
      if (typeof correctAnswer === 'string') {
        const trimmed = correctAnswer.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          correctAnswer = parseJsonField(trimmed, 'correctAnswer');
        } else if (trimmed === '') {
          correctAnswer = [];
        } else {
          correctAnswer = trimmed;
        }
      }
      if (questionType === 'judge') {
        const value = Array.isArray(correctAnswer) ? correctAnswer[0] : correctAnswer;
        correctAnswer = [String(value).toLowerCase() === 'true' ? 'true' : String(value).toLowerCase() === 'false' ? 'false' : String(value)];
      } else if (questionType === 'fill') {
        correctAnswer = Array.isArray(correctAnswer)
          ? correctAnswer
          : String(correctAnswer).split(/[;；]/).map((item) => item.trim()).filter(Boolean);
      } else if (['single', 'multiple'].includes(questionType) && !Array.isArray(correctAnswer)) {
        correctAnswer = String(correctAnswer).split(/[,，;；]/).map((item) => item.trim()).filter(Boolean);
      } else if (questionType === 'short') {
        correctAnswer = [];
      }

      const payload = {
        bankId: Number(bankId),
        knowledgePointId: kpIdRaw ? Number(kpIdRaw) : (knowledgePointId || null),
        questionType,
        difficulty,
        stem,
        options: parseJsonField(rawOptions, 'options'),
        correctAnswer,
        scoringPoints: parseJsonField(rawPoints, 'scoringPoints'),
        analysis: pick(row, ['analysis', '解析']) || null,
        defaultScore: score,
        status: ['draft', 'published'].includes(status) ? status : 'published',
      };
      validateQuestionPayload(payload);

      sequence += 1;
      const questionNo = `Q-${new Date().getUTCFullYear()}-${String(sequence).padStart(6, '0')}`;
      if (existingQuestionNos.has(questionNo)) throw fail(90409, { message: '题号重复' });
      existingQuestionNos.add(questionNo);
      valid.push({ ...payload, questionNo });
    } catch (err) {
      failures.push({ rowNo, reason: err.message || '数据格式错误' });
    }
  });

  const importedQuestionIds = await db.withTransaction(async (conn) => {
    const ids = [];
    for (const item of valid) {
      const id = await questionModel.createQuestion({ ...item, createdBy: user.id }, conn);
      await questionModel.addVersion(id, 1, buildSnapshot({ ...item, id }), 'create', '批量导入', user.id, conn);
      ids.push(id);
    }
    await questionModel.refreshBankQuestionCount(bankId, conn);
    await auditModel.write({
      userId: user.id,
      module: 'qbm',
      action: 'question.import',
      requestSummary: { bankId, totalRows: rows.length, successCount: valid.length, failureCount: failures.length },
      result: 'success',
    }, conn);
    return ids;
  });

  return {
    totalRows: rows.length,
    successCount: valid.length,
    failureCount: failures.length,
    failures,
    importedQuestionIds,
  };
}

async function exportQuestions(query, user) {
  const filters = {
    bankId: query.bankId ? Number(query.bankId) : null,
    questionType: query.questionType,
    knowledgePointId: query.knowledgePointId ? Number(query.knowledgePointId) : null,
  };
  const rows = await questionModel.listQuestionsForExport(filters, user, 10000);
  await auditModel.write({
    userId: user.id,
    module: 'qbm',
    action: 'question.export',
    requestSummary: { filters, count: rows.length },
    result: 'success',
  });
  return rows;
}

module.exports = {
  listBanks,
  createBank,
  updateBank,
  deleteBank,
  authorizeBank,
  listQuestions,
  createQuestion,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  listVersions,
  getReferences,
  importQuestions,
  exportQuestions,
  assertBankAccess,
  buildSnapshot,
};