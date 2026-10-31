/**
 * 业务页页头：标题 + 说明 + 操作区（内核浅色）
 */
import { cx } from '../utils/format.js';

export default function PageHeader({ title, desc, actions, meta, className }) {
  return (
    <div className={cx('page-head', className)}>
      <div>
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
        {meta ? <div className="row gap-2 mt-2 row-wrap">{meta}</div> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </div>
  );
}