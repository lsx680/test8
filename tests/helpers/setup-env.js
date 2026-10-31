'use strict';

/**
 * 在加载任何 backend 模块前写入测试环境变量（jest setupFiles 中执行）。
 * backend/src/config/env.js 使用 dotenv 且不覆盖已有值，因此这里设置的优先级最高。
 */
const config = require('./env');

process.env.NODE_ENV = 'test';
process.env.DB_HOST = config.host;
process.env.DB_PORT = String(config.port);
process.env.DB_USER = config.user;
process.env.DB_PASSWORD = config.password;
process.env.DB_NAME = config.database;
process.env.DB_CONNECTION_LIMIT = '5';
process.env.DB_SSL = 'false';
process.env.JWT_SECRET = config.jwtSecret;
process.env.JWT_EXPIRES_IN = '7200';
process.env.JWT_REFRESH_EXPIRES_IN = '604800';
process.env.BCRYPT_ROUNDS = '4';
process.env.CORS_ORIGIN = '*';
// 集成测试会在短时间内反复登录，必须放宽限流，避免 429 造成假失败
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '10000';
process.env.LOG_LEVEL = 'silent';
process.env.TZ = 'UTC';