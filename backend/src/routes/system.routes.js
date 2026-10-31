'use strict';

const express = require('express');
const controller = require('../controllers/system.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { audit } = require('../middleware/audit');
const schemas = require('../validators/schemas');

const router = express.Router();

/* 参数 */
router.get('/configs', authenticate, authorize('config.read'), controller.listConfigs);
router.put('/configs/:configKey', authenticate, authorize('config.update'), validate({ body: schemas.configUpdate }), controller.updateConfig);

/* 审计 */
router.get('/audit-logs', authenticate, authorize('audit.read'), controller.listAuditLogs);
router.get('/audit-logs/export', authenticate, authorize('audit.export'), controller.exportAuditLogs);

/* 公告 */
router.get('/notices', authenticate, authorize('notice.read'), controller.listNotices);
router.post('/notices', authenticate, authorize('notice.manage'), validate({ body: schemas.noticeCreate }), controller.createNotice);
router.put('/notices/:noticeId', authenticate, authorize('notice.manage'), validate({ body: schemas.noticeCreate }), controller.updateNotice);
router.delete('/notices/:noticeId', authenticate, authorize('notice.manage'), controller.deleteNotice);

/* 站内通知 */
router.get('/notifications', authenticate, authorize('notification.read'), controller.listNotifications);
router.patch('/notifications/:notificationId/read', authenticate, authorize('notification.read'), audit('sys', 'notification.read'), controller.markNotificationRead);

/* 备份 */
router.get('/backups', authenticate, authorize('backup.read'), controller.listBackups);
router.post('/backups', authenticate, authorize('backup.trigger'), controller.triggerBackup);

/* 健康检查（公开） */
router.get('/health', controller.health);

module.exports = router;