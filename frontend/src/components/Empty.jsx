export default function Empty({ title = '暂无数据', desc = '', action = null, minHeight = 220 }) {
  return (
    <div className="state-box" style={{ minHeight }}>
      <span className="state-icon" aria-hidden="true">
        ◌
      </span>
      <span className="state-title">{title}</span>
      {desc ? <span className="state-desc">{desc}</span> : null}
      {action}
    </div>
  );
}