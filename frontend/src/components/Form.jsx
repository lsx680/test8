/**
 * 表单原子组件：字段容器 + 输入控件
 * 错误提示以 inline 方式展示（对接后端 422 errors 与本地校验）
 */
import { useId } from 'react';
import { cx } from '../utils/format.js';

/**
 * 字段容器 id 使用 React.useId 生成，保证跨渲染稳定
 * （早期实现用自增序号会导致每次渲染 id 变化，影响 label 关联与焦点）
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  error,
  hint,
  children,
  className,
}) {
  const generatedId = useId();
  const id = htmlFor || generatedId;
  return (
    <div className={cx('field', className)}>
      {label ? (
        <label className="field-label" htmlFor={id}>
          {label}
          {required ? <span className="req">*</span> : null}
        </label>
      ) : null}
      {typeof children === 'function' ? children({ id, invalid: Boolean(error) }) : children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ invalid, className, ...rest }) {
  return <input className={cx('input', className)} aria-invalid={invalid ? 'true' : undefined} {...rest} />;
}

export function Textarea({ invalid, className, ...rest }) {
  return <textarea className={cx('textarea', className)} aria-invalid={invalid ? 'true' : undefined} {...rest} />;
}

export function Select({ invalid, className, options, children, ...rest }) {
  return (
    <select className={cx('select', className)} aria-invalid={invalid ? 'true' : undefined} {...rest}>
      {children ??
        (options || []).map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
    </select>
  );
}

/** 复选框行 */
export function CheckLine({ label, hint, ...rest }) {
  return (
    <label className="checkbox-line" style={{ marginBottom: 14 }}>
      <input type="checkbox" {...rest} />
      <span>
        {label}
        {hint ? <span className="xs muted" style={{ marginLeft: 6 }}>{hint}</span> : null}
      </span>
    </label>
  );
}

export default FormField;