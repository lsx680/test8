'use strict';

const auditModel = require('../models/audit.model');
const { buildRequestSummary } = require('./requestContext');

/**
 * 审计中间件：响应结束后异步落库（失败不影响主流程）
 * 敏感操作统一挂载 audit(module, action)
 */
function audit(module, action, { captureBody = true } = {}) {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const user = req.user || {};
      auditModel.write({
        userId: user.id || null,
        username: user.username || (req.body && req.body.username ? String(req.body.username) : null),
        roleCode: user.roleCode || null,
        module,
        action,
        httpMethod: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestSummary: captureBody ? buildRequestSummary(req) : null,
        result: res.statusCode < 400 ? 'success' : 'failure',
        errorCode: res.locals.errorCode || null,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  };
}

module.exports = { audit };