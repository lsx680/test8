'use strict';

const userService = require('../services/user.service');
const { success, created, page } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.listUsers = asyncHandler(async (req, res) => page(res, await userService.listUsers(req.query)));

exports.createUser = asyncHandler(async (req, res) => {
  const data = await userService.createUser(req.body, req.user.id, req.ip);
  return created(res, data);
});

exports.listPending = asyncHandler(async (req, res) => page(res, await userService.listPending(req.query)));

exports.getUser = asyncHandler(async (req, res) => success(res, await userService.getUser(req.params.userId)));

exports.updateUser = asyncHandler(async (req, res) => {
  const data = await userService.updateUser(req.params.userId, req.body, req.user.id);
  return success(res, data);
});

exports.updateStatus = asyncHandler(async (req, res) => {
  await userService.updateStatus(req.params.userId, req.body, req.user.id);
  return success(res, null);
});

exports.updateRole = asyncHandler(async (req, res) => {
  await userService.updateRole(req.params.userId, req.body, req.user.id);
  return success(res, null);
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const data = await userService.resetPassword(req.params.userId, req.user.id);
  return success(res, data);
});

exports.approve = asyncHandler(async (req, res) => {
  await userService.approve(req.params.userId, req.user.id);
  return success(res, null);
});

exports.reject = asyncHandler(async (req, res) => {
  await userService.reject(req.params.userId, req.body.reason, req.user.id);
  return success(res, null);
});

exports.listRoles = asyncHandler(async (req, res) => success(res, await userService.listRoles()));

exports.listPermissions = asyncHandler(async (req, res) => success(res, await userService.listPermissions()));

exports.listClasses = asyncHandler(async (req, res) => success(res, await userService.listClasses()));

exports.createClass = asyncHandler(async (req, res) => {
  const data = await userService.createClass(req.body, req.user.id);
  return created(res, data);
});