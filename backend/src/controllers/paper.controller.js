'use strict';

const paperService = require('../services/paper.service');
const { success, created, page } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.listPapers = asyncHandler(async (req, res) => page(res, await paperService.listPapers(req.query, req.user)));

exports.createPaper = asyncHandler(async (req, res) => created(res, await paperService.createPaper(req.body, req.user)));

exports.randomAssemble = asyncHandler(async (req, res) => success(res, await paperService.randomAssemblePaper(req.body, req.user)));

exports.getPaper = asyncHandler(async (req, res) => success(res, await paperService.getPaper(req.params.paperId, req.user)));

exports.updatePaper = asyncHandler(async (req, res) => {
  await paperService.updatePaper(req.params.paperId, req.body, req.user);
  return success(res, null);
});

exports.deletePaper = asyncHandler(async (req, res) => {
  await paperService.deletePaper(req.params.paperId, req.user);
  return success(res, null);
});

exports.addQuestions = asyncHandler(async (req, res) => {
  const data = await paperService.addPaperQuestions(req.params.paperId, req.body, req.user);
  return success(res, data);
});

exports.updateQuestions = asyncHandler(async (req, res) => {
  const data = await paperService.updatePaperQuestions(req.params.paperId, req.body, req.user);
  return success(res, data);
});

exports.removeQuestion = asyncHandler(async (req, res) => {
  await paperService.removePaperQuestion(req.params.paperId, req.params.paperQuestionId, req.user);
  return success(res, null);
});

exports.preview = asyncHandler(async (req, res) => success(res, await paperService.previewPaper(req.params.paperId, req.user)));

exports.copy = asyncHandler(async (req, res) => created(res, await paperService.copyPaper(req.params.paperId, req.body, req.user)));

exports.updateStatus = asyncHandler(async (req, res) => {
  await paperService.updatePaperStatus(req.params.paperId, req.body, req.user);
  return success(res, null);
});