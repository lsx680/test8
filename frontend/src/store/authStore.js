import { create } from 'zustand';
import { configureHttp } from '../api/http.js';
import * as authApi from '../api/auth.js';

/**
 * 鉴权状态（zustand）
 * ------------------------------------------------------------
 * 安全约定（设计文档 §3.1.9 状态管理方案）：
 * - Access Token 仅保存在内存变量中，不落 localStorage，降低 XSS 窃取风险
 * - Refresh Token 保存在 localStorage，用于刷新页面后恢复会话；每次刷新轮换
 * - 用户与权限点来自 GET /auth/me，仅用于菜单与路由守卫（非安全边界）
 */

const REFRESH_KEY = 'oes.refreshToken';

/** Access Token 内存载体（模块级，不进入持久化） */
let accessTokenMemory = null;

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: typeof window !== 'undefined' ? window.localStorage.getItem(REFRESH_KEY) : null,
  /** idle | loading | authed | anon */
  status: 'idle',

  /** 登录：写入令牌与用户，返回 LoginResult（含 homeRoute） */
  async login(credentials) {
    const result = await authApi.login(credentials);
    accessTokenMemory = result.accessToken;
    if (result.refreshToken) window.localStorage.setItem(REFRESH_KEY, result.refreshToken);
    set({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      status: 'authed',
    });
    return result;
  },

  /**
   * 应用启动恢复会话：优先用 Refresh Token 换新 Access Token，再拉取用户信息。
   * 任一环节失败即视为未登录，避免停留在半登录状态。
   */
  async bootstrap() {
    const stored = get().refreshToken || window.localStorage.getItem(REFRESH_KEY);
    if (!stored) {
      set({ status: 'anon', user: null, accessToken: null, refreshToken: null });
      return null;
    }
    set({ status: 'loading' });
    try {
      const tokens = await authApi.refreshToken(stored);
      accessTokenMemory = tokens.accessToken;
      window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
      set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        status: 'loading',
      });
      const user = await authApi.getCurrentUser();
      set({ user, status: 'authed' });
      return user;
    } catch {
      accessTokenMemory = null;
      window.localStorage.removeItem(REFRESH_KEY);
      set({ status: 'anon', user: null, accessToken: null, refreshToken: null });
      return null;
    }
  },

  /** 由 http 拦截器在 401 时调用：轮换令牌并返回新的 Access Token */
  async refreshSession() {
    const stored = get().refreshToken || window.localStorage.getItem(REFRESH_KEY);
    if (!stored) throw new Error('no refresh token');
    const tokens = await authApi.refreshToken(stored);
    accessTokenMemory = tokens.accessToken;
    window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, status: 'authed' });
    return tokens.accessToken;
  },

  /** 主动登出：先吊销服务端 Refresh Token，再清理本地状态 */
  async logout() {
    const rt = get().refreshToken || window.localStorage.getItem(REFRESH_KEY);
    try {
      await authApi.logout(rt);
    } catch {
      // 网络异常也要保证本地登出，避免用户被困
    }
    get().clearSession();
  },

  /** 清空会话（401 兜底 / 主动登出） */
  clearSession() {
    accessTokenMemory = null;
    window.localStorage.removeItem(REFRESH_KEY);
    set({ user: null, accessToken: null, refreshToken: null, status: 'anon' });
  },

  /** 资料修改后同步本地用户 */
  setUser(user) {
    set({ user });
  },

  hasRole(role) {
    const current = get().user?.roleCode;
    if (!current) return false;
    if (Array.isArray(role)) return role.includes(current);
    return current === role;
  },

  /** 是否具备某权限点（仅用于按钮显隐） */
  can(permCode) {
    return Boolean(get().user?.permissions?.includes(permCode));
  },
}));

/* 将令牌读写与刷新能力注入 http 层（避免循环依赖） */
configureHttp({
  getAccessToken: () => accessTokenMemory,
  refresh: () => useAuthStore.getState().refreshSession(),
  onUnauthorized: () => useAuthStore.getState().clearSession(),
});

/** 路由守卫与拦截器需要的同步读取入口 */
export const authHelpers = {
  isAuthed: () => useAuthStore.getState().status === 'authed',
  currentUser: () => useAuthStore.getState().user,
};