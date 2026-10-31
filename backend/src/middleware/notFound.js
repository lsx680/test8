'use strict';

const { fail } = require('../utils/errors');

/** 未匹配路由统一 404（90401） */
function notFound(req, res, next) {
  next(fail(90401, { message: `接口不存在：${req.method} ${req.originalUrl}` }));
}

module.exports = { notFound };