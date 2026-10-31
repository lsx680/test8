'use strict';

const knowledgeService = require('../services/knowledge.service');
const { success, created } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.list = asyncHandler(async (req, res) => {
  const includeArchived = String(req.query.includeArchived) === 'true';
  return success(res, await knowledgeService.listTree({ includeArchived }));
});

exports.create = asyncHandler(async (req, res) => {
  return created(res, await knowledgeService.create(req.body, req.user.id));
});

exports.update = asyncHandler(async (req, res) => {
  const data = await knowledgeService.update(req.params.kpId, req.body, req.user.id);
  return success(res, data);
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const data = await knowledgeService.updateStatus(req.params.kpId, req.body.status, req.user.id);
  return success(res, data);
});