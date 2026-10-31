import { del, get, patch, post, put } from './http.js';

/**
 * 用户与权限管理 API（14 个端点）
 * operationId：listUsers / createUser / listPendingRegistrations / getUser /
 * updateUser / updateUserStatus / updateUserRole / resetUserPassword /
 * approveRegistration / rejectRegistration / listRoles / listPermissions /
 * listClasses / createClass
 */

export const listUsers = (params) => get('/users', params);
export const createUser = (payload) => post('/users', payload);
export const listPendingRegistrations = (params) => get('/users/pending', params);
export const getUser = (userId) => get(`/users/${userId}`);
export const updateUser = (userId, payload) => put(`/users/${userId}`, payload);
export const updateUserStatus = (userId, payload) => patch(`/users/${userId}/status`, payload);
export const updateUserRole = (userId, payload) => patch(`/users/${userId}/role`, payload);
export const resetUserPassword = (userId) => post(`/users/${userId}/reset-password`);
export const approveRegistration = (userId) => post(`/users/${userId}/approve`);
export const rejectRegistration = (userId, reason) => post(`/users/${userId}/reject`, { reason });

export const listRoles = () => get('/roles');
export const listPermissions = () => get('/permissions');

export const listClasses = (params, config) => get('/classes', params, config);
export const createClass = (payload) => post('/classes', payload);

// 供需要删除用户的场景保留统一导出（契约未提供删除端点，前端不发起该请求）
export { del };