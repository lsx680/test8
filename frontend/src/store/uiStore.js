import { create } from 'zustand';

let seq = 0;
const DEFAULT_DURATION = 3600;

/**
 * 全局 UI 状态：提示（toast）与全局遮罩。
 * 提示由 uiStore 统一持有，http 拦截器与页面均可调用 pushToast。
 */
export const useUiStore = create((set, get) => ({
  toasts: [],
  busy: false,

  /**
   * @param {{type?:'success'|'error'|'warning'|'info', title?:string, message:string, duration?:number}} payload
   */
  pushToast(payload) {
    const type = payload?.type || 'info';
    const id = ++seq;
    const titleMap = {
      success: '操作成功',
      error: '操作失败',
      warning: '请注意',
      info: '提示',
    };
    const toast = {
      id,
      type,
      title: payload?.title || titleMap[type],
      message: payload?.message || '',
      duration: payload?.duration ?? DEFAULT_DURATION,
    };
    set((state) => ({ toasts: [...state.toasts, toast] }));
    if (toast.duration > 0) {
      setTimeout(() => get().removeToast(id), toast.duration);
    }
    return id;
  },

  removeToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  setBusy(busy) {
    set({ busy: Boolean(busy) });
  },
}));

/** 便捷方法：页面中直接 import { toast } 使用 */
export const toast = {
  success: (message, title) => useUiStore.getState().pushToast({ type: 'success', message, title }),
  error: (message, title) => useUiStore.getState().pushToast({ type: 'error', message, title }),
  warning: (message, title) => useUiStore.getState().pushToast({ type: 'warning', message, title }),
  info: (message, title) => useUiStore.getState().pushToast({ type: 'info', message, title }),
};