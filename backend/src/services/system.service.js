'use strict';

/**
 * 系统管理服务：参数、审计日志、公告、站内通知、数据备份、健康检查
 * 依据：设计文档 §3.8
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const systemModel = require('../models/system.model');
const auditModel = require('../models/audit.model');
const configService = require('./config.service');
const env = require('../config/env');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { parsePagination, pageResult } = require('../utils/pagination');

/* ------------------------------ 参数 ------------------------------ */

async function listConfigs(query) {
  return configService.list(query.group);
}

async function updateConfig(configKey, { configValue, reason }, user) {
  return configService.update(configKey, configValue, user.id, reason);
}

/* ------------------------------ 审计日志 ------------------------------ */

function auditFilters(query) {
  return {
    startTime: query.startTime,
    endTime: query.endTime,
    userId: query.userId ? Number(query.userId) : null,
    action: query.action,
    module: query.module,
    result: query.result,
    username: query.username,
  };
}

async function listAuditLogs(query) {
  const pagination = parsePagination(query);
  const filters = auditFilters(query);
  const [list, total] = await Promise.all([
    auditModel.list(filters, pagination),
    auditModel.count(filters),
  ]);
  return pageResult(list, total, pagination);
}

async function exportAuditLogs(query, user) {
  const filters = auditFilters(query);
  const rows = await auditModel.listAll(filters, 10000);
  await auditModel.write({
    userId: user.id,
    module: 'sys',
    action: 'audit.export',
    requestSummary: { filters, count: rows.length },
    result: 'success',
  });
  return rows;
}

/* ------------------------------ 公告 ------------------------------ */

async function listNotices(query, user) {
  const pagination = parsePagination(query);
  const [list, total] = await Promise.all([
    systemModel.listNotices(user.roleCode, pagination),
    systemModel.countNotices(user.roleCode),
  ]);
  return pageResult(list, total, pagination);
}

async function createNotice(payload, user) {
  if (user.roleCode !== 'admin') throw fail(90301);
  const publishAt = payload.publishAt ? new Date(payload.publishAt) : (payload.status === 'draft' ? null : new Date());
  const noticeId = await systemModel.createNotice({
    ...payload,
    publishAt,
    expireAt: payload.expireAt ? new Date(payload.expireAt) : null,
    status: payload.status || 'published',
  }, user.id);
  await auditModel.write({
    userId: user.id,
    module: 'sys',
    action: 'notice.create',
    requestSummary: { noticeId, title: payload.title, targetRole: payload.targetRole },
    result: 'success',
  });
  return systemModel.findNoticeById(noticeId);
}

async function updateNotice(noticeId, payload, user) {
  if (user.roleCode !== 'admin') throw fail(90301);
  const existing = await systemModel.findNoticeById(noticeId);
  if (!existing) throw fail(90401);
  const publishAt = payload.publishAt
    ? new Date(payload.publishAt)
    : (existing.publishAt ? new Date(existing.publishAt) : null);
  const expireAt = payload.expireAt
    ? new Date(payload.expireAt)
    : (payload.expireAt === null ? null : (existing.expireAt ? new Date(existing.expireAt) : null));
  await systemModel.updateNotice(noticeId, {
    ...payload,
    publishAt,
    expireAt,
  });
  await auditModel.write({
    userId: user.id,
    module: 'sys',
    action: 'notice.update',
    requestSummary: { noticeId },
    result: 'success',
  });
  return systemModel.findNoticeById(noticeId);
}

async function deleteNotice(noticeId, user) {
  if (user.roleCode !== 'admin') throw fail(90301);
  const existing = await systemModel.findNoticeById(noticeId);
  if (!existing) throw fail(90401);
  await systemModel.deleteNotice(noticeId);
  await auditModel.write({
    userId: user.id,
    module: 'sys',
    action: 'notice.delete',
    requestSummary: { noticeId },
    result: 'success',
  });
  return null;
}

/* ------------------------------ 站内通知 ------------------------------ */

async function listNotifications(query, user) {
  const pagination = parsePagination(query);
  const isRead = query.isRead === undefined || query.isRead === '' ? null : (String(query.isRead) === 'true');
  const [list, total, unreadCount] = await Promise.all([
    systemModel.listNotifications(user.id, isRead, pagination),
    systemModel.countNotifications(user.id, isRead),
    systemModel.countUnread(user.id),
  ]);
  return pageResult(list, total, pagination, { unreadCount });
}

async function markNotificationRead(notificationId, user) {
  const affected = await systemModel.markNotificationRead(notificationId, user.id);
  if (affected === 0) throw fail(90401, { message: '通知不存在或不属于当前用户' });
  return null;
}

/* ------------------------------ 备份 ------------------------------ */

let backupInProgress = false;

function timestampForFile() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function pruneOldBackups() {
  systemModel.listBackupsForPrune(7)
    .then(async (rows) => {
      for (const row of rows) {
        try {
          if (row.filePath && fs.existsSync(row.filePath)) fs.unlinkSync(row.filePath);
        } catch (err) {
          // 文件删除失败不影响记录
        }
      }
    })
    .catch(() => {});
}

async function listBackups(query) {
  const pagination = parsePagination(query);
  const [list, total] = await Promise.all([
    systemModel.listBackups(pagination),
    systemModel.countBackups(),
  ]);
  return pageResult(list, total, pagination, { retentionCount: 7 });
}

/**
 * 手动备份：调用 mysqldump 逻辑备份（异步执行，202 受理）
 * 未安装 mysqldump 时记录 status=failed 并写明原因，不伪造成功
 */
async function triggerBackup(user) {
  if (backupInProgress) throw fail(70103);
  const running = await systemModel.findRunningBackup();
  if (running) throw fail(70103);

  backupInProgress = true;
  const fileName = `oes_${timestampForFile()}.sql`;
  const dir = path.resolve(env.backupDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  const recordId = await systemModel.createBackup({
    fileName,
    filePath,
    triggerType: 'manual',
    status: 'running',
    tableCount: 31,
    operatorId: user.id,
  });

  const output = fs.createWriteStream(filePath);
  const dump = spawn('mysqldump', [
    '--single-transaction',
    '--routines',
    '--triggers',
    '--host', env.dbHost,
    '--port', String(env.dbPort),
    '--user', env.dbUser,
    env.dbName,
  ], {
    env: { ...process.env, MYSQL_PWD: env.dbPassword },
    windowsHide: true,
  });

  const finalize = async (status, remark) => {
    backupInProgress = false;
    let fileSize = null;
    try {
      if (fs.existsSync(filePath)) fileSize = fs.statSync(filePath).size;
    } catch (err) {
      fileSize = null;
    }
    await systemModel.finishBackup(recordId, { status, fileSize, remark });
    if (status === 'success') pruneOldBackups();
    await auditModel.write({
      userId: user.id,
      module: 'sys',
      action: 'backup.trigger',
      requestSummary: { recordId, fileName, status, remark: remark || null },
      result: status === 'success' ? 'success' : 'failure',
      errorCode: status === 'success' ? null : '90500',
    });
  };

  dump.stdout.pipe(output);
  dump.on('error', (err) => {
    output.end();
    finalize('failed', `mysqldump 启动失败：${err.message}`).catch(() => {});
  });
  dump.on('close', (code) => {
    output.end();
    if (code === 0) finalize('success', null).catch(() => {});
    else finalize('failed', `mysqldump 退出码 ${code}`).catch(() => {});
  });

  return systemModel.findBackupById(recordId);
}

/* ------------------------------ 健康检查 ------------------------------ */

async function getHealth() {
  let database = 'connected';
  let status = 'up';
  try {
    await Promise.race([
      db.ping(),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('db timeout')), 500)),
    ]);
  } catch (err) {
    database = 'disconnected';
    status = 'degraded';
  }
  return {
    status,
    database,
    version: '1.0.0',
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: env.nodeEnv,
  };
}

module.exports = {
  listConfigs,
  updateConfig,
  listAuditLogs,
  exportAuditLogs,
  listNotices,
  createNotice,
  updateNotice,
  deleteNotice,
  listNotifications,
  markNotificationRead,
  listBackups,
  triggerBackup,
  getHealth,
};