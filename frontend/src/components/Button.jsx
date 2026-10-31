/**
 * 按钮：统一视觉与禁用/加载态
 * variant: primary | secondary | danger | ghost
 */
import { cx } from '../utils/format.js';

export default function Button({
  children,
  variant = 'secondary',
  size,
  block = false,
  loading = false,
  className,
  type = 'button',
  disabled,
  ...rest
}) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : null}
      {children}
    </button>
  );
}