'use strict';

const attemptService = require('../services/attempt.service');
const { success, created } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.startAttempt = asyncHandler(async (req, res) => {
  const { replayed, session } = await attemptService.startAttempt(
    req.params.examId,
    req.body || {},
    req.user,
    { ip: req.ip },
  );
  return replayed ? success(res, session) : created(res, session);
});

exports.recover = asyncHandler(async (req, res) => success(res, await attemptService.recoverAttempt(req.params.attemptId, req.user)));

exports.getQuestions = asyncHandler(async (req, res) => success(res, await attemptService.getAttemptQuestions(req.params.attemptId, req.user)));

exports.remainingTime = asyncHandler(async (req, res) => success(res, await attemptService.getRemainingTime(req.params.attemptId, req.user)));

exports.saveAnswers = asyncHandler(async (req, res) => {
  const data = await attemptService.saveAnswers(req.params.attemptId, req.body, req.user);
  return success(res, data);
});

exports.reportCheatEvent = asyncHandler(async (req, res) => {
  const data = await attemptService.reportAntiCheatEvent(req.params.attemptId, req.body, req.user, { ip: req.ip });
  return success(res, data);
});

exports.submit = asyncHandler(async (req, res) => {
  const data = await attemptService.submitAttempt(req.params.attemptId, req.body || {}, req.user, { ip: req.ip });
  return success(res, data);
});

exports.grade = asyncHandler(async (req, res) => success(res, await attemptService.gradeAttempt(req.params.attemptId, req.user)));