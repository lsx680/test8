import { del, get, http, patch, post, put } from './http.js';

/**
 * 系统管理 API（13 个端点）
 * operationId：listConfigs / updateConfig / listAuditLogs / exportAuditLogs /
 * listNotices / createNotice / updateNotice / deleteNotice / listNotifications /
 * markNotificationRead / listBackups / triggerBackup / getHealth
 */

export const listConfigs = (params) => get('/configs', params);
export const updateConfig = (configKey, configValue, reason) =>
  put(`/configs/${encodeURIComponent(configKey)}`, { configValue, reason });

export const listAuditLogs = (params) => get('/audit-logs', params);

/** 导出审计日志（CSV Blob） */
export const exportAuditLogs = (params) =>
  http.get('/audit-logs/export', { params, responseType: 'blob', timeout: 60000 });

export const listNotices = (params) => get('/notices', params);
export const createNotice = (payload) => post('/notices', payload);
export const updateNotice = (noticeId, payload) => put(`/notices/${noticeId}`, payload);
export const deleteNotice = (noticeId) => del(`/notices/${noticeId}`);

export const listNotifications = (params) => get('/notifications', params);
export const markNotificationRead = (notificationId) =>
  patch(`/notifications/${notificationId}/read`);

export const listBackups = (params) => get('/backups', params);
export const triggerBackup = () => post('/backups');

/** 健康检查（公开接口，security: []） */
export const getHealth = () => get('/health', undefined, { silent: true });