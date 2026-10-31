'use strict';

const { ERROR_CODES } = require('../config/constants');

/**
 * 业务异常：携带 5 位业务码（设计文档 §5.4），HTTP 状态由错误码表统一映射
 */
class ApiError extends Error {
  constructor(code, options = {}) {
    const meta = ERROR_CODES[code] || ERROR_CODES[90500];
    super(options.message || meta.message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = options.httpStatus || meta.http;
    this.errors = options.errors || null;
    this.data = options.data === undefined ? null : options.data;
  }
}

/** 快速构造业务异常 */
function fail(code, options) {
  return new ApiError(code, options);
}

/** 字段级校验失败（422 / 90101） */
function validationError(errors) {
  return new ApiError(90101, { errors });
}

/** 包装异步路由，异常统一交给 errorHandler */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ApiError, fail, validationError, asyncHandler };