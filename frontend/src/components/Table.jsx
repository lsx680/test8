/**
 * 数据表格
 * columns: [{ key, title, width, render(row, index), className }]
 * 统一处理加载、空态、错误态与横向滚动
 */
import Loading from './Loading.jsx';
import Empty from './Empty.jsx';
import ErrorState from './ErrorState.jsx';

export default function Table({
  columns = [],
  rows = [],
  rowKey = 'id',
  loading = false,
  error = null,
  onRetry,
  emptyTitle = '暂无数据',
  emptyDesc = '调整筛选条件后重试，或先创建一条记录。',
  dense = false,
}) {
  if (loading) return <Loading text="正在加载数据…" />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows.length) return <Empty title={emptyTitle} desc={emptyDesc} />;

  const resolveKey = (row, index) => {
    if (typeof rowKey === 'function') return rowKey(row, index);
    return row?.[rowKey] ?? index;
  };

  return (
    <div className="table-wrap">
      <table className="data-table" style={dense ? { fontSize: 'var(--oe-text-sm)' } : undefined}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={resolveKey(row, index)}>
              {columns.map((col) => (
                <td key={col.key} className={col.className}>
                  {col.render ? col.render(row, index) : row?.[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}