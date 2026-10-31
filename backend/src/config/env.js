'use strict';

/**
 * 环境变量读取与校验（缺失关键项立即失败，避免带病启动）
 * 依据：系统设计文档 §3.1.8、§6.4
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || String(value) === '1';
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const env = {
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  port: toInt(process.env.PORT, 3000),

  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: toInt(process.env.DB_PORT, 3306),
  dbUser: process.env.DB_USER || 'oes_app',
  dbPassword: process.env.DB_PASSWORD || '',
  dbName: process.env.DB_NAME || 'oes',
  dbConnectionLimit: toInt(process.env.DB_CONNECTION_LIMIT, 10),
  dbSsl: toBool(process.env.DB_SSL, false),

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: toInt(process.env.JWT_EXPIRES_IN, 7200),
  jwtRefreshExpiresIn: toInt(process.env.JWT_REFRESH_EXPIRES_IN, 604800),
  bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 10),

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  logLevel: process.env.LOG_LEVEL || 'info',
  rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 10),
  backupDir: process.env.BACKUP_DIR || path.resolve(__dirname, '../../backups'),
};

if (env.isProduction) {
  const problems = [];
  if (!env.jwtSecret || env.jwtSecret.length < 32) problems.push('JWT_SECRET 必须为不少于 32 字节的随机串');
  if (!env.dbPassword) problems.push('DB_PASSWORD 不能为空');
  if (problems.length > 0) {
    throw new Error(`[config] 生产环境配置不合法：${problems.join('；')}`);
  }
}

module.exports = env;