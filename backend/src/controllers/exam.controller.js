'use strict';

const examService = require('../services/exam.service');
const { success, created, page } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.listExams = asyncHandler(async (req, res) => page(res, await examService.listExams(req.query, req.user)));

exports.createExam = asyncHandler(async (req, res) => created(res, await examService.createExam(req.body, req.user)));

exports.listAvailable = asyncHandler(async (req, res) => page(res, await examService.listAvailableExams(req.query, req.user)));

exports.getExam = asyncHandler(async (req, res) => success(res, await examService.getExam(req.params.examId, req.user)));

exports.updateExam = asyncHandler(async (req, res) => {
  await examService.updateExam(req.params.examId, req.body, req.user);
  return success(res, null);
});

exports.publishExam = asyncHandler(async (req, res) => success(res, await examService.publishExam(req.params.examId, req.user)));

exports.updateStatus = asyncHandler(async (req, res) => {
  await examService.updateExamStatus(req.params.examId, req.body, req.user);
  return success(res, null);
});

exports.listTasks = asyncHandler(async (req, res) => page(res, await examService.listExamTasks(req.params.examId, req.query, req.user)));

exports.grantAttempts = asyncHandler(async (req, res) => {
  await examService.grantExtraAttempts(req.params.examId, req.body, req.user, req.ip);
  return success(res, null);
});

exports.monitor = asyncHandler(async (req, res) => success(res, await examService.getExamMonitor(req.params.examId, req.user)));

exports.listAntiCheatEvents = asyncHandler(async (req, res) => page(res, await examService.listAntiCheatEvents(req.params.examId, req.query, req.user)));