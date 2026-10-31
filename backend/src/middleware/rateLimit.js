'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/**
 * 登录/注册限流（设计文档 §3.2.4 防暴力破解）
 * 统一返回 429 + 90429，响应体与其它接口一致
 */
const authLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ code: 90429, message: '请求过于频繁，请稍后再试', errors: null, data: null });
  },
});

module.exports = { authLimiter };