'use strict';

const { sanitizeForAudit } = require('../utils/mask');

/**
 * 请求上下文：traceId + 耗时 + 结构化访问日志
 * 日志禁止输出密码、令牌、答题内容（设计文档 §3.1.7）
 */
function requestContext(req, res, next) {
  const traceId = req.headers['x-trace-id'] || require('crypto').randomUUID();
  const startedAt = process.hrtime.bigint();
  req.traceId = traceId;
  res.locals.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const log = {
      timestamp: new Date().toISOString(),
      traceId,
      userId: req.user ? req.user.id : null,
      roleCode: req.user ? req.user.roleCode : null,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      code: res.locals.businessCode === undefined ? 0 : res.locals.businessCode,
      durationMs: Number(durationMs.toFixed(1)),
      msg: res.locals.logMessage || 'request',
    };
    // 仅记录方法/路径/状态，不记录请求体（避免敏感信息入日志）
    const line = JSON.stringify(log);
    if (res.statusCode >= 500) console.error(line);
    else if (process.env.LOG_LEVEL !== 'silent') console.log(line);
  });
  next();
}

/** 供审计中间件复用的请求摘要（已脱敏） */
function buildRequestSummary(req) {
  if (!req.body || Object.keys(req.body).length === 0) return null;
  try {
    const summary = JSON.stringify({
      method: req.method,
      path: req.originalUrl,
      body: sanitizeForAudit(req.body),
    });
    if (summary.length > 2000) return `${summary.slice(0, 2000)}...[truncated]`;
    return summary;
  } catch (err) {
    return null;
  }
}

module.exports = { requestContext, buildRequestSummary };