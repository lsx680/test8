/**
 * 分页器：page 从 1 开始，pageSize 默认 20（契约默认值）
 */
import { cx } from '../utils/format.js';

function buildPages(page, totalPages) {
  const pages = [];
  const push = (p) => {
    if (!pages.includes(p) && p >= 1 && p <= totalPages) pages.push(p);
  };
  push(1);
  for (let p = page - 1; p <= page + 1; p += 1) push(p);
  push(totalPages);
  return pages.sort((a, b) => a - b);
}

export default function Pagination({
  page = 1,
  pageSize = 20,
  total = 0,
  onChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className,
}) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pages = buildPages(safePage, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);

  return (
    <div className={cx('list-meta', className)}>
      <div className="small muted">
        共 <b className="mono">{total}</b> 条 · 当前 {from}-{to}
        {onPageSizeChange ? (
          <select
            className="select"
            style={{ width: 92, height: 28, padding: '2px 6px', marginLeft: 10, fontSize: 12 }}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="每页条数"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size} 条/页
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <nav className="pager" aria-label="分页">
        <span className="pager-info">
          {safePage} / {totalPages}
        </span>
        <button type="button" onClick={() => onChange(safePage - 1)} disabled={safePage <= 1}>
          上一页
        </button>
        {pages.map((p, i) => (
          <span key={p} className="row" style={{ display: 'inline-flex' }}>
            {i > 0 && p - pages[i - 1] > 1 ? (
              <span className="muted" style={{ padding: '0 2px' }}>
                …
              </span>
            ) : null}
            <button
              type="button"
              className={p === safePage ? 'active' : ''}
              onClick={() => onChange(p)}
              aria-current={p === safePage ? 'page' : undefined}
            >
              {p}
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => onChange(safePage + 1)}
          disabled={safePage >= totalPages}
        >
          下一页
        </button>
      </nav>
    </div>
  );
}