import { get, post, put } from './http.js';

/**
 * 认证与账号 API（对应契约「一、认证与账号」7 个端点）
 * operationId：registerStudent / login / refreshToken / logout /
 *              getCurrentUser / updateProfile / changePassword
 */

/** POST /auth/register —— 学生注册申请（公开） */
export const registerStudent = (payload) => post('/auth/register', payload);

/** POST /auth/login —— 账号登录（公开，失败由页面 inline 展示） */
export const login = (payload) => post('/auth/login', payload, { silent: true });

/** POST /auth/refresh —— 令牌刷新与轮换（公开） */
export const refreshToken = (refreshTokenValue) =>
  post('/auth/refresh', { refreshToken: refreshTokenValue }, { silent: true });

/** POST /auth/logout —— 安全登出 */
export const logout = (refreshTokenValue) =>
  post('/auth/logout', refreshTokenValue ? { refreshToken: refreshTokenValue } : {}, { silent: true });

/** GET /auth/me —— 当前用户与权限点 */
export const getCurrentUser = () => get('/auth/me');

/** PUT /auth/profile —— 修改本人资料 */
export const updateProfile = (payload) => put('/auth/profile', payload);

/** PUT /auth/password —— 修改本人密码（改密后需重新登录） */
export const changePassword = (payload) => put('/auth/password', payload);