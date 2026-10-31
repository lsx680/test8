'use strict';

const authService = require('../services/auth.service');
const { success, created } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body, { ip: req.ip });
  return created(res, data);
});

exports.login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  return success(res, data);
});

exports.refresh = asyncHandler(async (req, res) => {
  const data = await authService.refresh(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  return success(res, data);
});

exports.logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id, req.body.refreshToken, { ip: req.ip });
  return success(res, null);
});

exports.me = asyncHandler(async (req, res) => {
  return success(res, await authService.me(req.user.id));
});

exports.updateProfile = asyncHandler(async (req, res) => {
  return success(res, await authService.updateProfile(req.user.id, req.body));
});

exports.changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user.id, req.body);
  return success(res, null);
});