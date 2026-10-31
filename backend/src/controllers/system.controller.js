'use strict';

const systemService = require('../services/system.service');
const { sendCsv } = require('../utils/excel');
const { success, created, accepted, page } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

/* ------------------------------ 参数 ------------------------------ */

exports.listConfigs = asyncHandler(async (req, res) => success(res, await systemService.listConfigs(req.query)));

exports.updateConfig = asyncHandler(async (req, res) => {
  const data = await systemService.updateConfig(req.params.configKey, req.body, req.user);
  return success(res, data);
});

/* ------------------------------ 审计 ------------------------------ */

exports.listAuditLogs = asyncHandler(async (req, res) => page(res, await systemService.listAuditLogs(req.query)));

exports.exportAuditLogs = asyncHandler(async (req, res) => {
  const rows = await systemService.exportAuditLogs(req.query, req.user);
  await sendCsv(res, 'audit-logs.csv', [
    { header: 'ID', key: 'id' },
    { header: '操作人ID', key: 'userId' },
    { header: '登录名', key: 'username' },
    { header: '角色', key: 'roleCode' },
    { header: '模块', key: 'module' },
    { header: '动作', key: 'action' },
    { header: '方法', key: 'httpMethod' },
    { header: '路径', key: 'path' },
    { header: 'IP', key: 'ip' },
    { header: '结果', key: 'result' },
    { header: '错误码', key: 'errorCode' },
    { header: '耗时(ms)', key: 'durationMs' },
    { header: '时间', key: 'createdAt' },
  ], rows);
});

/* ------------------------------ 公告 ------------------------------ */

exports.listNotices = asyncHandler(async (req, res) => page(res, await systemService.listNotices(req.query, req.user)));

exports.createNotice = asyncHandler(async (req, res) => created(res, await systemService.createNotice(req.body, req.user)));

exports.updateNotice = asyncHandler(async (req, res) => {
  const data = await systemService.updateNotice(req.params.noticeId, req.body, req.user);
  return success(res, data);
});

exports.deleteNotice = asyncHandler(async (req, res) => {
  await systemService.deleteNotice(req.params.noticeId, req.user);
  return success(res, null);
});

/* ------------------------------ 通知 ------------------------------ */

exports.listNotifications = asyncHandler(async (req, res) => page(res, await systemService.listNotifications(req.query, req.user)));

exports.markNotificationRead = asyncHandler(async (req, res) => {
  await systemService.markNotificationRead(req.params.notificationId, req.user);
  return success(res, null);
});

/* ------------------------------ 备份 ------------------------------ */

exports.listBackups = asyncHandler(async (req, res) => page(res, await systemService.listBackups(req.query)));

exports.triggerBackup = asyncHandler(async (req, res) => accepted(res, await systemService.triggerBackup(req.user)));

/* ------------------------------ 健康检查 ------------------------------ */

exports.health = asyncHandler(async (req, res) => {
  const data = await systemService.getHealth();
  if (data.database === 'disconnected') {
    return res.status(503).json({ code: 90503, message: '数据库不可用，服务降级', errors: null, data });
  }
  return success(res, data);
});