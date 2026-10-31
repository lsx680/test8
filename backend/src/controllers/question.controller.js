'use strict';

const questionService = require('../services/question.service');
const gradingService = require('../services/grading.service');
const { readTabular, sendWorkbook } = require('../utils/excel');
const { success, created, page } = require('../utils/response');
const { asyncHandler, fail } = require('../utils/errors');

/* ------------------------------ 题库 ------------------------------ */

exports.listBanks = asyncHandler(async (req, res) => page(res, await questionService.listBanks(req.query, req.user)));

exports.createBank = asyncHandler(async (req, res) => created(res, await questionService.createBank(req.body, req.user)));

exports.updateBank = asyncHandler(async (req, res) => {
  const data = await questionService.updateBank(req.params.bankId, req.body, req.user);
  return success(res, data);
});

exports.deleteBank = asyncHandler(async (req, res) => {
  await questionService.deleteBank(req.params.bankId, req.user);
  return success(res, null);
});

exports.authorizeBank = asyncHandler(async (req, res) => {
  await questionService.authorizeBank(req.params.bankId, req.body, req.user);
  return success(res, null);
});

/* ------------------------------ 题目 ------------------------------ */

exports.listQuestions = asyncHandler(async (req, res) => page(res, await questionService.listQuestions(req.query, req.user)));

exports.createQuestion = asyncHandler(async (req, res) => created(res, await questionService.createQuestion(req.body, req.user)));

exports.getQuestion = asyncHandler(async (req, res) => success(res, await questionService.getQuestion(req.params.questionId, req.user)));

exports.updateQuestion = asyncHandler(async (req, res) => {
  const data = await questionService.updateQuestion(req.params.questionId, req.body, req.user);
  return success(res, data);
});

exports.deleteQuestion = asyncHandler(async (req, res) => {
  await questionService.deleteQuestion(req.params.questionId, req.user);
  return success(res, null);
});

exports.listVersions = asyncHandler(async (req, res) => success(res, await questionService.listVersions(req.params.questionId, req.user)));

exports.getReferences = asyncHandler(async (req, res) => success(res, await questionService.getReferences(req.params.questionId, req.user)));

exports.importQuestions = asyncHandler(async (req, res) => {
  if (!req.file) throw fail(20104, { message: '请上传 .xlsx 或 .csv 文件' });
  const rows = await readTabular(req.file.buffer, req.file.originalname);
  const data = await questionService.importQuestions({
    rows,
    bankId: Number(req.body.bankId),
    knowledgePointId: req.body.knowledgePointId ? Number(req.body.knowledgePointId) : null,
    defaultScore: req.body.defaultScore ? Number(req.body.defaultScore) : null,
    user: req.user,
  });
  return success(res, data);
});

exports.exportQuestions = asyncHandler(async (req, res) => {
  const rows = await questionService.exportQuestions(req.query, req.user);
  await sendWorkbook(res, 'questions.xlsx', '题目', [
    { header: '题号', key: 'questionNo', width: 18 },
    { header: '题库', key: 'bankName', width: 24 },
    { header: '题型', key: 'questionType', width: 10 },
    { header: '难度', key: 'difficulty', width: 8 },
    { header: '题干', key: 'stem', width: 60 },
    { header: '选项(JSON)', key: 'optionsJson', width: 40 },
    { header: '标准答案(JSON)', key: 'answerJson', width: 26 },
    { header: '采分点(JSON)', key: 'pointsJson', width: 40 },
    { header: '解析', key: 'analysis', width: 60 },
    { header: '分值', key: 'defaultScore', width: 8 },
    { header: '知识点', key: 'knowledgePointName', width: 20 },
    { header: '状态', key: 'status', width: 10 },
  ], rows.map((row) => ({
    ...row,
    optionsJson: row.options ? JSON.stringify(row.options) : '',
    answerJson: JSON.stringify(row.correctAnswer),
    pointsJson: row.scoringPoints ? JSON.stringify(row.scoringPoints) : '',
  })));
});

exports.rejudge = asyncHandler(async (req, res) => {
  const data = await gradingService.rejudgeQuestion(req.params.questionId, req.body, req.user);
  return success(res, data);
});