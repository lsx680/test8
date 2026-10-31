'use strict';

/**
 * MySQL 连接池（mysql2/promise）
 * - 全部 SQL 使用参数化占位符，禁止字符串拼接
 * - 时区统一 UTC（DATETIME(3) 存 UTC），DECIMAL 以 Number 返回
 * - 提供轻量事务封装 withTransaction，service 层为事务边界
 */
const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  waitForConnections: true,
  connectionLimit: env.dbConnectionLimit,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: false,
  decimalNumbers: true,
  charset: 'utf8mb4',
  namedPlaceholders: false,
  ssl: env.dbSsl ? { rejectUnauthorized: false } : undefined,
});

// 每个新连接强制 UTC 会话时区，保证 DEFAULT CURRENT_TIMESTAMP 与 UTC_TIMESTAMP 一致
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

/** 参数化查询 */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** 取单行（无结果返回 null） */
async function queryOne(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** 取单值 */
async function queryValue(sql, params = []) {
  const row = await queryOne(sql, params);
  if (!row) return null;
  return row[Object.keys(row)[0]];
}

/**
 * 事务封装：fn(conn) 内所有 SQL 必须使用 conn 执行
 * 抛出异常自动回滚，业务错误码原样上抛
 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      // 回滚失败仅记录，不覆盖原始异常
      // eslint-disable-next-line no-console
      console.error('[db] transaction rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function ping() {
  const start = Date.now();
  await pool.query('SELECT 1');
  return Date.now() - start;
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, queryOne, queryValue, withTransaction, ping, close };