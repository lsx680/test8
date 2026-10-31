'use strict';

/** 用户与权限管理服务 */
const userModel = require('../models/user.model');
const rbacModel = require('../models/rbac.model');
const tokenModel = require('../models/token.model');
const auditModel = require('../models/audit.model');
const authService = require('./auth.service');
const db = require('../config/db');
const { fail } = require('../utils/errors');
const { hashPassword, generateTemporaryPassword } = require('../utils/password');
const { parsePagination, pageResult } = require('../utils/pagination');
const { invalidatePermissionCache } = require('../middleware/rbac');

async function listUsers(query) {
  const pagination = parsePagination(query);
  const filters = {
    keyword: query.keyword,
    roleCode: query.roleCode,
    status: query.status,
    classId: query.classId ? Number(query.classId) : null,
  };
  const [list, total] = await Promise.all([
    userModel.list(filters, pagination),
    userModel.count(filters),
  ]);
  return pageResult(list, total, pagination);
}

async function createUser(payload, operatorId, ip) {
  const existing = await userModel.existsUsernameOrEmail(payload.username, payload.email);
  if (existing) {
    if (existing.email && existing.email === payload.email) throw fail(10106);
    throw fail(10105);
  }
  if (payload.roleCode === 'student' && !payload.classId) {
    throw fail(90101, { errors: [{ field: 'classId', message: '学生账号必须指定班级' }] });
  }
  if (payload.classId) {
    const classInfo = await userModel.findClassById(payload.classId);
    if (!classInfo) throw fail(90401, { message: '班级不存在' });
  }
  const initialPassword = generateTemporaryPassword(12);
  const userId = await userModel.create({
    username: payload.username,
    passwordHash: await hashPassword(initialPassword),
    realName: payload.realName,
    email: payload.email,
    phone: payload.phone,
    roleCode: payload.roleCode,
    classId: payload.classId,
    department: payload.department,
    status: 'active',
    registerChannel: 'admin',
    remark: payload.remark,
    createdBy: operatorId,
  });
  await auditModel.write({
    userId: operatorId,
    module: 'uam',
    action: 'user.create',
    httpMethod: 'POST',
    ip,
    requestSummary: { targetUserId: userId, username: payload.username, roleCode: payload.roleCode },
    result: 'success',
  });
  const user = await userModel.findById(userId);
  return { user, initialPassword };
}

async function listPending(query) {
  const pagination = parsePagination(query);
  const [list, total] = await Promise.all([
    userModel.listPending(pagination),
    userModel.countPending(),
  ]);
  return pageResult(list, total, pagination);
}

async function getUser(userId) {
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  return user;
}

async function updateUser(userId, payload, operatorId) {
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  if (payload.email) {
    const existing = await userModel.findByEmail(payload.email);
    if (existing && existing.id !== Number(userId)) throw fail(10106);
  }
  await userModel.update(userId, payload);
  await auditModel.write({
    userId: operatorId,
    module: 'uam',
    action: 'user.update',
    requestSummary: { targetUserId: userId, fields: Object.keys(payload) },
    result: 'success',
  });
  return getUser(userId);
}

async function updateStatus(userId, { status, reason }, operatorId) {
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  const affected = await userModel.updateStatus(userId, status, reason);
  if (affected === 0) throw fail(90409);
  if (status === 'disabled') {
    await tokenModel.revokeAllForUser(userId, 'disabled');
    invalidatePermissionCache(user.roleCode);
  }
  await auditModel.write({
    userId: operatorId,
    module: 'uam',
    action: 'user.status',
    requestSummary: { targetUserId: userId, status, reason: reason || null },
    result: 'success',
  });
  return null;
}

async function updateRole(userId, { roleCode }, operatorId) {
  const role = await rbacModel.findRoleByCode(roleCode);
  if (!role) throw fail(90101, { errors: [{ field: 'roleCode', message: '角色不存在' }] });
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  if (roleCode === 'student' && !user.classId) {
    throw fail(90101, { errors: [{ field: 'classId', message: '学生角色必须绑定班级，请先编辑用户班级' }] });
  }
  await userModel.updateRole(userId, roleCode);
  await tokenModel.revokeAllForUser(userId, 'role_changed');
  invalidatePermissionCache(user.roleCode);
  invalidatePermissionCache(roleCode);
  await auditModel.write({
    userId: operatorId,
    module: 'uam',
    action: 'user.role',
    requestSummary: { targetUserId: userId, fromRole: user.roleCode, toRole: roleCode },
    result: 'success',
  });
  return null;
}

async function resetPassword(userId, operatorId) {
  const result = await authService.resetPasswordByAdmin(userId);
  await auditModel.write({
    userId: operatorId,
    module: 'uam',
    action: 'user.resetPassword',
    requestSummary: { targetUserId: userId },
    result: 'success',
  });
  return result;
}

async function approve(userId, operatorId) {
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  const affected = await userModel.approve(userId);
  if (affected === 0) throw fail(10110);
  await auditModel.write({
    userId: operatorId,
    module: 'uam',
    action: 'user.approve',
    requestSummary: { targetUserId: userId, username: user.username },
    result: 'success',
  });
  return null;
}

async function reject(userId, reason, operatorId) {
  const user = await userModel.findById(userId);
  if (!user) throw fail(90401);
  const affected = await userModel.reject(userId, reason);
  if (affected === 0) throw fail(10110);
  await auditModel.write({
    userId: operatorId,
    module: 'uam',
    action: 'user.reject',
    requestSummary: { targetUserId: userId, username: user.username, reason },
    result: 'success',
  });
  return null;
}

async function listRoles() {
  return rbacModel.listRoles();
}

async function listPermissions() {
  return rbacModel.listPermissions();
}

async function listClasses() {
  return userModel.listClasses();
}

async function createClass(payload, operatorId) {
  if (payload.headTeacherId) {
    const teacher = await userModel.findById(payload.headTeacherId);
    if (!teacher || teacher.roleCode !== 'teacher') throw fail(90101, { errors: [{ field: 'headTeacherId', message: '班主任必须是教师账号' }] });
  }
  try {
    const id = await userModel.createClass(payload);
    await auditModel.write({
      userId: operatorId,
      module: 'uam',
      action: 'class.create',
      requestSummary: { classId: id, classCode: payload.classCode },
      result: 'success',
    });
    return userModel.findClassById(id);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw fail(90409, { message: '班级编码已存在' });
    throw err;
  }
}

/** 供考试发布使用：按班级/学生范围展开参考学生 */
async function resolveScopeStudents({ classIds = [], studentIds = [] }) {
  const [fromClasses, directStudents] = await Promise.all([
    userModel.listStudentIdsByClasses(classIds),
    userModel.findStudentsByIds(studentIds),
  ]);
  const idSet = new Set(fromClasses);
  directStudents.forEach((student) => idSet.add(student.id));
  return [...idSet];
}

module.exports = {
  listUsers,
  createUser,
  listPending,
  getUser,
  updateUser,
  updateStatus,
  updateRole,
  resetPassword,
  approve,
  reject,
  listRoles,
  listPermissions,
  listClasses,
  createClass,
  resolveScopeStudents,
};