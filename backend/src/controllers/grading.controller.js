'use strict';

const gradingService = require('../services/grading.service');
const { success, page } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.listTasks = asyncHandler(async (req, res) => page(res, await gradingService.listGradingTasks(req.query, req.user)));

exports.getTask = asyncHandler(async (req, res) => success(res, await gradingService.getGradingTask(req.params.taskId, req.user)));

exports.score = asyncHandler(async (req, res) => success(res, await gradingService.scoreGradingTask(req.params.taskId, req.body, req.user)));

exports.arbitrate = asyncHandler(async (req, res) => success(res, await gradingService.arbitrateGradingTask(req.params.taskId, req.body, req.user)));

exports.progress = asyncHandler(async (req, res) => success(res, await gradingService.getGradingProgress(req.params.examId, req.user)));