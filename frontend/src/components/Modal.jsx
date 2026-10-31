/**
 * 模态框：基于 Portal 渲染到 body，支持 Esc 关闭与焦点初始定位
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils/format.js';

export default function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  wide = false,
  closeOnBackdrop = true,
  labelledBy = 'modal-title',
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 打开后聚焦面板，便于键盘用户继续操作
    panelRef.current?.focus?.();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className={cx('modal', wide && 'modal-wide')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 className="modal-title" id={labelledBy}>
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭弹窗">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}