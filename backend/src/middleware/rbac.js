'use strict';

const { fail } = require('../utils/errors');
const rbacModel = require('../models/rbac.model');

/**
 * 功能权限（RBAC）：基于 sys_role_permission 的权限点集合判定
 * 权限点缓存 60s，角色权限变更后由 userService 主动失效
 */
const cache = new Map(); // roleCode -> { codes: Set, expiresAt }
const TTL_MS = 60 * 1000;

async function getRolePermissions(roleCode, { force = false } = {}) {
  const cached = cache.get(roleCode);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.codes;
  const codes = new Set(await rbacModel.listPermissionCodesByRole(roleCode));
  cache.set(roleCode, { codes, expiresAt: Date.now() + TTL_MS });
  return codes;
}

function invalidatePermissionCache(roleCode) {
  if (roleCode) cache.delete(roleCode);
  else cache.clear();
}

/** 权限点校验中间件；未配置权限点的接口视为需登录（由 authenticate 保证） */
function authorize(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.user) throw fail(90201);
      if (req.user.roleCode === 'admin') return next();
      const codes = await getRolePermissions(req.user.roleCode);
      if (!codes.has(permissionCode)) throw fail(90301);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authorize, getRolePermissions, invalidatePermissionCache, requireRole };

/** 角色白名单（用于未配置权限点的管理端接口） */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(fail(90201));
    if (!roles.includes(req.user.roleCode)) return next(fail(90301));
    return next();
  };
}