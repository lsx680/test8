'use strict';

/**
 * 数据库初始化：执行 docs/design/schema.sql（可重复执行，会 DROP 同名表）
 * 使用 root 账号建库建表，随后按需创建最小权限应用账号。
 *
 * 用法：npm run db:init
 * 依赖 .env：DB_HOST/DB_PORT/DB_ROOT_USER/DB_ROOT_PASSWORD/DB_NAME/DB_USER/DB_PASSWORD
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../src/config/env');

function loadRootCredentials() {
  return {
    host: process.env.DB_HOST || env.dbHost,
    port: Number(process.env.DB_PORT || env.dbPort),
    user: process.env.DB_ROOT_USER || 'root',
    password: process.env.DB_ROOT_PASSWORD === undefined ? '' : process.env.DB_ROOT_PASSWORD,
    multipleStatements: true,
  };
}

async function main() {
  const schemaPath = path.resolve(__dirname, '../../docs/design/schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`未找到建表脚本：${schemaPath}`);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const connConfig = loadRootCredentials();
  console.log(`[db:init] connecting ${connConfig.user}@${connConfig.host}:${connConfig.port}`);
  const conn = await mysql.createConnection(connConfig);
  try {
    await conn.query("SET time_zone = '+00:00'");
    console.log('[db:init] executing docs/design/schema.sql ...');
    await conn.query(sql);
    console.log('[db:init] schema executed successfully');

    const appUser = env.dbUser;
    const appPassword = env.dbPassword;
    if (appUser && appUser !== connConfig.user) {
      try {
        await conn.query(
          `CREATE USER IF NOT EXISTS ${conn.escape(appUser)}@'%' IDENTIFIED BY ${conn.escape(appPassword)}`,
        );
        await conn.query(`GRANT ALL PRIVILEGES ON ${conn.escapeId(env.dbName)}.* TO ${conn.escape(appUser)}@'%'`);
        await conn.query('FLUSH PRIVILEGES');
        console.log(`[db:init] application user ${appUser} ready`);
      } catch (err) {
        console.warn(`[db:init] 应用账号创建失败（可手动创建）：${err.message}`);
      }
    }

    const dbConn = await mysql.createConnection({
      host: connConfig.host,
      port: connConfig.port,
      user: connConfig.user,
      password: connConfig.password,
      database: env.dbName,
    });
    const [tables] = await dbConn.query(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?",
      [env.dbName],
    );
    const [users] = await dbConn.query('SELECT username, role_code, status FROM sys_user ORDER BY id ASC');
    console.log(`[db:init] database=${env.dbName} tables=${tables[0].total} (expected 31)`);
    console.log('[db:init] seed accounts:');
    users.forEach((user) => console.log(`  - ${user.username} (${user.role_code}, ${user.status})`));
    console.log('[db:init] default passwords: admin/Admin@2026, T2024001/Teacher@2026, S2024001/Student@2026');
    await dbConn.end();
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`[db:init] FAILED: ${err.message}`);
  if (err.code === 'ECONNREFUSED') {
    console.error('[db:init] 请先启动 MySQL：docker compose up -d mysql');
  }
  process.exitCode = 1;
});