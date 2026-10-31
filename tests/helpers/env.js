'use strict';

/**
 * 测试环境配置读取：
 * 1. 从 backend/.env 读取真实数据库/JWT 配置（后端开发者已实测可用）
 * 2. 测试一律使用独立库 exam_system_test，绝不复用开发库 oes，避免污染
 * 3. 允许通过环境变量覆盖（如 CI 使用其它 MySQL 实例）
 */
const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../../backend');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function parseEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const fileEnv = parseEnvFile(path.join(BACKEND_DIR, '.env'));

function pick(key, fallback) {
  const value = process.env[key];
  if (value !== undefined && value !== '') return value;
  if (fileEnv[key] !== undefined && fileEnv[key] !== '') return fileEnv[key];
  return fallback;
}

const database = process.env.TEST_DB_NAME || 'exam_system_test';

const config = {
  BACKEND_DIR,
  PROJECT_ROOT,
  database,
  host: pick('DB_HOST', '127.0.0.1'),
  port: Number(pick('DB_PORT', 3306)),
  user: pick('DB_USER', 'oes_app'),
  password: pick('DB_PASSWORD', ''),
  rootUser: pick('DB_ROOT_USER', 'root'),
  rootPassword: pick('DB_ROOT_PASSWORD', ''),
  jwtSecret: pick('JWT_SECRET', 'test-only-secret-0123456789-abcdefghijklmnop'),
  schemaPath: path.join(PROJECT_ROOT, 'docs/design/schema.sql'),
  apiContractPath: path.join(PROJECT_ROOT, 'docs/design/api-contract.yaml'),
  frontendApiDir: path.join(PROJECT_ROOT, 'frontend/src/api'),
};

module.exports = config;