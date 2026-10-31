import axios from 'axios';
import { useUiStore } from '../store/uiStore';

/**
 * Axios 实例与全局拦截器
 * ------------------------------------------------------------
 * 1. baseURL 取 VITE_API_BASE_URL，默认 http://localhost:3000/api/v1
 * 2. 请求拦截：注入 Authorization: Bearer <accessToken>
 * 3. 响应拦截：解包统一响应体 { code, message, data }，code=0 返回 data
 * 4. 401：尝试用 Refresh Token 轮换并重放一次；失败则清空会话并跳登录
 * 5. 403：跳转 Forbidden 页面；其它业务错误统一 toast（可静默）
 * 6. 为兼容文件下载，binery 响应直接返回 Blob
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * 契约错误码 → 可执行的下一步建议（设计文档 §3.1.9 交互约定 6）
 * toast 中展示"后端原因 + 下一步建议"，避免用户无从下手
 */
const ERROR_HINTS = {
  10101: '请确认学号/工号与密码是否正确，注意大小写。',
  10102: '注册申请正在审核中，请联系管理员完成审批后再登录。',
  10103: '账号已被禁用，请联系系统管理员核实。',
  10104: '账号因连续登录失败被临时锁定，请稍后重试或联系管理员。',
  10105: '该账号已存在，请更换学号/工号或直接登录。',
  10106: '该邮箱已被占用，请更换邮箱。',
  10107: '密码强度不足，请使用不少于 8 位且包含大小写字母与数字的密码。',
  10108: '旧密码不正确，请重新输入。',
  20106: '题目已被试卷或考试引用，无法删除，可改为归档。',
  20109: '采分点分值之和超过题目满分，请调整分值。',
  30101: '各题分值之和不等于设定总分，请调整题目分值或总分。',
  30103: '试卷已被考试引用并锁定，如需修改请先解除关联考试。',
  30107: '可用题目不足，请放宽难度比例或补充题库题目。',
  40104: '当前不在考试开放时间内，请关注考试公告。',
  40106: '考试已结束，无法继续作答。',
  40108: '作答次数已用尽，请联系任课教师申请补考授权。',
  40109: '答卷已交卷，无法继续操作。',
  50109: '仍有主观题未阅完，完成全部阅卷后再发布成绩。',
  60101: '成绩尚未发布，请等待教师发布后再查看。',
  70103: '已有备份任务执行中，请稍后查看结果。',
  90203: '登录状态已过期，请重新登录。',
  90301: '当前账号无权执行该操作，如需授权请联系管理员。',
  90302: '该数据不属于你的数据范围，无法访问。',
};

const NETWORK_MESSAGE = '无法连接服务端，请确认后端服务已启动（默认 http://localhost:3000）。';

/** 业务错误对象：页面可读取 code / errors / data 做字段级处理 */
export class ApiError extends Error {
  constructor({ status = 0, code = -1, message = '请求失败', errors = [], data = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors || [];
    this.data = data;
    this.isNetwork = status === 0;
  }

  /** 统一展示文案：原因 + 下一步建议 */
  get displayMessage() {
    const hint = ERROR_HINTS[this.code];
    if (this.isNetwork) return this.message;
    if (hint && hint !== this.message) return `${this.message}（${hint}）`;
    return this.message;
  }
}

/* ---------------- 与 authStore 解耦的钩子注册 ---------------- */
const hooks = {
  getAccessToken: () => null,
  refresh: null,
  onUnauthorized: null,
};

/** authStore 初始化时注入，避免 http ↔ store 循环依赖 */
export function configureHttp(partial) {
  Object.assign(hooks, partial);
}

/* ---------------- 导航：由 router 注册，避免整页刷新 ---------------- */
let navigateFn = null;
export function setNavigator(fn) {
  navigateFn = fn;
}

function go(path) {
  if (navigateFn) {
    navigateFn(path, { replace: true });
    return;
  }
  // router 尚未就绪（极少数早期错误）时退化为地址跳转
  window.location.assign(path);
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

/* ---------------- 刷新令牌串行化 ---------------- */
let refreshing = null;

async function refreshOnce() {
  if (!hooks.refresh) return null;
  if (!refreshing) {
    refreshing = hooks
      .refresh()
      .then((token) => token)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

function notifyError(err, config = {}) {
  if (config.silent) return;
  const push = useUiStore.getState().pushToast;
  push({ type: 'error', title: '操作失败', message: err.displayMessage, duration: 4200 });
}

/* ---------------- 请求拦截 ---------------- */
http.interceptors.request.use(
  (config) => {
    const token = hooks.getAccessToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/* ---------------- 响应拦截 ---------------- */
http.interceptors.response.use(
  (response) => {
    // 文件流（Excel / CSV）直接返回 Blob
    const config = response.config || {};
    if (config.responseType === 'blob' || config.responseType === 'arraybuffer') {
      return response.data;
    }
    const body = response.data;
    if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'code')) {
      if (body.code === 0) return body.data;
      const err = new ApiError({
        status: response.status,
        code: body.code,
        message: body.message || '请求失败',
        errors: body.errors,
        data: body.data,
      });
      notifyError(err, config);
      return Promise.reject(err);
    }
    return body;
  },
  async (error) => {
    const config = error.config || {};

    // 请求被取消：静默
    if (axios.isCancel?.(error) || error.code === 'ERR_CANCELED') {
      return Promise.reject(error);
    }

    // 网络层错误（后端未启动、跨域、超时）
    if (!error.response) {
      const err = new ApiError({
        status: 0,
        code: -1,
        message: error.code === 'ECONNABORTED' ? '请求超时，请检查网络后重试。' : NETWORK_MESSAGE,
      });
      notifyError(err, config);
      return Promise.reject(err);
    }

    const { status, data } = error.response;
    const body = data && typeof data === 'object' ? data : {};
    const apiError = new ApiError({
      status,
      code: body.code ?? status,
      message: body.message || `请求失败（HTTP ${status}）`,
      errors: body.errors,
      data: body.data,
    });

    const isAuthEndpoint = /\/auth\/(login|refresh|register)$/.test(config.url || '');
    const publicPages = /^\/(login|register|403|404|500)/.test(window.location.pathname);
    const isLoginPage = publicPages;

    // 401：令牌过期 → 刷新并重放一次；其余 401 → 清会话跳登录
    if (status === 401 && !isAuthEndpoint && !config.__retried) {
      try {
        const token = await refreshOnce();
        if (token) {
          config.__retried = true;
          return http(config);
        }
      } catch {
        /* 刷新失败走统一登出流程 */
      }
      if (hooks.onUnauthorized) hooks.onUnauthorized();
      if (!isLoginPage) {
        notifyError(
          new ApiError({ status: 401, code: 90203, message: '登录状态已失效，请重新登录。' }),
          { ...config, silent: true },
        );
        go(`/login?redirect=${encodeURIComponent(currentPath())}`);
      }
      return Promise.reject(apiError);
    }

    // 403：权限不足跳 403 页（公开页/403 页自身除外，避免注册页拉取班级字典被跳走）
    if (status === 403 && !publicPages && window.location.pathname !== '/403') {
      notifyError(apiError, config);
      go('/403');
      return Promise.reject(apiError);
    }

    notifyError(apiError, config);
    return Promise.reject(apiError);
  },
);

/* ---------------- 便捷方法 ---------------- */
export const get = (url, params, config = {}) => http.get(url, { params, ...config });
export const post = (url, body, config = {}) => http.post(url, body, config);
export const put = (url, body, config = {}) => http.put(url, body, config);
export const patch = (url, body, config = {}) => http.patch(url, body, config);
export const del = (url, config = {}) => http.delete(url, config);

export default http;