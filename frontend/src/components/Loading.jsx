export default function Loading({ text = '正在加载…', minHeight = 220 }) {
  return (
    <div className="state-box" style={{ minHeight }} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="state-desc">{text}</span>
    </div>
  );
}