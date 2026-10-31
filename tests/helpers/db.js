'use strict';

/** 测试侧数据库直连（用于断言数据库真实状态，不经 HTTP 层） */
const mysql = require('mysql2/promise');
const config = require('./env');

let connection = null;

async function getConnection() {
  if (!connection) {
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      charset: 'utf8mb4',
      multipleStatements: false,
    });
  }
  return connection;
}

async function sql(text, params = []) {
  const conn = await getConnection();
  const [rows] = await conn.query(text, params);
  return rows;
}

async function closeConnection() {
  if (connection) {
    await connection.end();
    connection = null;
  }
}

/** 关闭 backend 连接池（每个测试文件独立 module registry，需各自关闭） */
async function closeBackendPool() {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const db = require('../../backend/src/config/db');
    await db.close();
  } catch (err) {
    // 未加载过 backend 模块时无需关闭
  }
}

module.exports = { sql, getConnection, closeConnection, closeBackendPool };