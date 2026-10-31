'use strict';

/** 角色与权限点数据访问层 */
const db = require('../config/db');

async function listRoles() {
  const sql = `SELECT id, role_code, role_name, description, is_builtin, created_at
    FROM sys_role ORDER BY id ASC`;
  const rows = await db.query(sql);
  return rows.map((row) => ({
    id: Number(row.id),
    roleCode: row.role_code,
    roleName: row.role_name,
    description: row.description,
    isBuiltin: Boolean(row.is_builtin),
  }));
}

async function listPermissions() {
  const sql = `SELECT id, perm_code, perm_name, module, http_method, path_pattern, description
    FROM sys_permission ORDER BY module ASC, id ASC`;
  const rows = await db.query(sql);
  return rows.map((row) => ({
    id: Number(row.id),
    permCode: row.perm_code,
    permName: row.perm_name,
    module: row.module,
    httpMethod: row.http_method,
    pathPattern: row.path_pattern,
    description: row.description,
  }));
}

async function listPermissionCodesByRole(roleCode) {
  const sql = `SELECT p.perm_code
    FROM sys_permission p
    JOIN sys_role_permission rp ON rp.permission_id = p.id
    JOIN sys_role r ON r.id = rp.role_id
    WHERE r.role_code = ?`;
  return (await db.query(sql, [roleCode])).map((row) => row.perm_code);
}

async function findRoleByCode(roleCode) {
  const sql = 'SELECT id, role_code, role_name, description, is_builtin FROM sys_role WHERE role_code = ? LIMIT 1';
  return db.queryOne(sql, [roleCode]);
}

module.exports = { listRoles, listPermissions, listPermissionCodesByRole, findRoleByCode };