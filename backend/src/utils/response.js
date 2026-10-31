'use strict';

/**
 * 统一响应体：{ code, message, data }
 * 设计文档 §5.2：HTTP 状态码与业务码同时表达语义，禁止 HTTP 200 + code 非 0 的伪成功
 */
function success(res, data = null, httpStatus = 200) {
  return res.status(httpStatus).json({ code: 0, message: 'ok', data });
}

function created(res, data = null) {
  return success(res, data, 201);
}

function accepted(res, data = null) {
  return success(res, data, 202);
}

/** 分页响应：data = { list, total, page, pageSize }，可附加额外字段 */
function page(res, payload, extra = {}) {
  return success(res, { ...payload, ...extra });
}

/** 失败响应（由 errorHandler 调用） */
function failure(res, { code, message, errors = null, data = null }, httpStatus = 500) {
  return res.status(httpStatus).json({ code, message, errors, data });
}

module.exports = { success, created, accepted, page, failure };