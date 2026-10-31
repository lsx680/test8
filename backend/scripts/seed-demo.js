'use strict';

/**
 * 演示数据补充脚本（可选）：新增 1 个教师与 2 个学生、1 个共享题库，便于联调
 * 用法：npm run seed:demo
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const env = require('../src/config/env');

async function upsertUser(conn, payload) {
  const [rows] = await conn.query('SELECT id FROM sys_user WHERE username = ?', [payload.username]);
  if (rows.length > 0) return rows[0].id;
  const hash = await bcrypt.hash(payload.password, env.bcryptRounds);
  const [result] = await conn.query(
    `INSERT INTO sys_user (username, password_hash, real_name, email, role_code, class_id, department, status, register_channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'admin')`,
    [payload.username, hash, payload.realName, payload.email, payload.roleCode, payload.classId || null, payload.department || null],
  );
  return result.insertId;
}

async function main() {
  const conn = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
  });
  try {
    const teacherId = await upsertUser(conn, {
      username: 'T2024002',
      password: 'Teacher@2026',
      realName: '赵敏',
      email: 'zhaomin@oes.edu.cn',
      roleCode: 'teacher',
      department: '计算机学院',
    });
    const student1 = await upsertUser(conn, {
      username: 'S2024002',
      password: 'Student@2026',
      realName: '陈晨',
      email: 'chenchen@oes.edu.cn',
      roleCode: 'student',
      classId: 1,
    });
    const student2 = await upsertUser(conn, {
      username: 'S2024003',
      password: 'Student@2026',
      realName: '周雨',
      email: 'zhouyu@oes.edu.cn',
      roleCode: 'student',
      classId: 2,
    });

    const [banks] = await conn.query('SELECT id FROM qb_question_bank WHERE bank_code = ?', ['BANK-DEMO-2026']);
    if (banks.length === 0) {
      await conn.query(
        `INSERT INTO qb_question_bank (bank_code, bank_name, owner_id, description, visibility, question_count, status)
         VALUES ('BANK-DEMO-2026', '演示共享题库', ?, 'seed-demo 创建的演示题库', 'shared', 0, 'active')`,
        [teacherId],
      );
    }
    console.log(`[seed:demo] teacher=${teacherId} students=${student1},${student2}`);
    console.log('[seed:demo] accounts: T2024002/Teacher@2026, S2024002/Student@2026, S2024003/Student@2026');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`[seed:demo] FAILED: ${err.message}`);
  process.exitCode = 1;
});