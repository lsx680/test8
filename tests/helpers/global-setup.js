'use strict';

/**
 * Jest globalSetup：为测试准备独立数据库
 * 步骤：
 *   1. 以 root 连接本机 MySQL（凭据来自 backend/.env 的 DB_ROOT_USER/DB_ROOT_PASSWORD）
 *   2. DROP + 重建 exam_system_test（绝不动开发库 oes）
 *   3. 执行 docs/design/schema.sql（把脚本中的库名 oes 替换为测试库名）
 *   4. 给应用账号授予测试库权限，并校验应用账号可读种子数据
 *
 * 说明：schema.sql 含 3 个种子账号（admin / T2024001 / S2024001），
 * 集成测试直接复用，避免在每个测试中重建基础字典数据。
 */
const fs = require('fs');
const mysql = require('mysql2/promise');
const config = require('./env');

async function globalSetup() {
  if (!fs.existsSync(config.schemaPath)) {
    throw new Error(`[global-setup] 未找到建表脚本：${config.schemaPath}`);
  }
  const schemaSql = fs
    .readFileSync(config.schemaPath, 'utf8')
    .split('`oes`')
    .join(`\`${config.database}\``);

  let adminConn;
  try {
    adminConn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.rootUser,
      password: config.rootPassword,
      multipleStatements: true,
      charset: 'utf8mb4',
    });
  } catch (err) {
    throw new Error(
      `[global-setup] 无法连接 MySQL（${config.host}:${config.port}，用户 ${config.rootUser}）：${err.message}。`
      + '请确认 MySQL 已启动且 backend/.env 中的 DB_ROOT_USER/DB_ROOT_PASSWORD 正确。',
    );
  }

  try {
    await adminConn.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
    await adminConn.query(schemaSql);

    try {
      await adminConn.query(
        `CREATE USER IF NOT EXISTS ${adminConn.escape(config.user)}@'%' IDENTIFIED BY ${adminConn.escape(config.password)}`,
      );
      await adminConn.query(
        `GRANT ALL PRIVILEGES ON \`${config.database}\`.* TO ${adminConn.escape(config.user)}@'%'`,
      );
      await adminConn.query('FLUSH PRIVILEGES');
    } catch (err) {
      // 已存在的账号可能无权限修改密码，只要授权成功即可
      // eslint-disable-next-line no-console
      console.warn(`[global-setup] 应用账号创建/授权提示：${err.message}`);
    }
  } finally {
    await adminConn.end();
  }

  const appConn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4',
  });
  try {
    const [users] = await appConn.query('SELECT username, role_code, status FROM sys_user ORDER BY id ASC');
    const [tables] = await appConn.query(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?',
      [config.database],
    );
    // eslint-disable-next-line no-console
    console.log(
      `[global-setup] 测试库 ${config.database} 就绪：表 ${tables[0].total} 张，种子账号 ${users.map((u) => u.username).join('/')}`,
    );
  } finally {
    await appConn.end();
  }
}

module.exports = globalSetup;