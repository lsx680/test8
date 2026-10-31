'use strict';

const { ApiError, validationError } = require('../utils/errors');
const response = require('../utils/response');

/**
 * 全局异常处理：业务异常 → 统一响应；未知异常 → 500（不返回堆栈）
 * MySQL 特定错误映射为业务状态冲突（设计文档 §3.1.7）
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let apiError = err;

  if (!(err instanceof ApiError)) {
    if (err && err.name === 'ZodError') {
      apiError = validationError(
        (err.issues || []).map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message })),
      );
    } else if (err && err.name === 'MulterError') {
      apiError = new ApiError(20104, {
        message: err.code === 'LIMIT_FILE_SIZE' ? '文件大小超过 5MB 限制' : `文件上传失败：${err.message}`,
      });
    } else if (err && err.type === 'entity.parse.failed') {
      apiError = new ApiError(90101, { message: '请求体不是合法的 JSON' });
    } else if (err && err.code === 'ER_DUP_ENTRY') {
      apiError = new ApiError(90409, { message: '数据已存在或违反唯一约束' });
    } else if (err && (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2')) {
      apiError = new ApiError(90409, { message: '数据存在关联引用，操作被拒绝' });
    } else if (err && ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(err.code)) {
      apiError = new ApiError(90503);
    } else {
      apiError = new ApiError(90500, { message: '服务器内部错误，请稍后重试' });
    }
  }

  res.locals.businessCode = apiError.code;
  res.locals.errorCode = String(apiError.code);
  res.locals.logMessage = apiError.message;

  const logPayload = {
    timestamp: new Date().toISOString(),
    traceId: req.traceId,
    userId: req.user ? req.user.id : null,
    method: req.method,
    path: req.originalUrl,
    status: apiError.httpStatus,
    code: apiError.code,
    errorCode: String(apiError.code),
    msg: err.message,
    stack: apiError.httpStatus >= 500 ? err.stack : undefined,
  };
  if (apiError.httpStatus >= 500) console.error(JSON.stringify(logPayload));
  else if (process.env.LOG_LEVEL === 'debug') console.log(JSON.stringify(logPayload));

  return response.failure(
    res,
    {
      code: apiError.code,
      message: apiError.message,
      errors: apiError.errors || null,
      data: apiError.data === undefined ? null : apiError.data,
    },
    apiError.httpStatus,
  );
}

module.exports = { errorHandler };