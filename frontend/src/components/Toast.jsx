/**
 * 全局提示渲染宿主
 * 提示数据由 uiStore 管理，http 拦截器与页面共用同一队列
 */
import { useUiStore } from '../store/uiStore.js';

export default function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  if (!toasts.length) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-mark" aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            style={{ color: 'var(--oe-text-dim)', width: 22, height: 22, fontSize: 12 }}
            onClick={() => removeToast(t.id)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}