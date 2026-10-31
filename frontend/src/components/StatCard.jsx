/**
 * 指标卡（深色外壳 / 仪表盘）
 * 与浅色内核的 .metric 区分，避免两类文字色混用
 */
import { cx } from '../utils/format.js';

export default function StatCard({ label, value, unit, hint, tone = 'cyan', children }) {
  return (
    <div className={cx('stat-card', `stat-${tone}`)}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value ?? '—'}
        {unit ? <small>{unit}</small> : null}
      </div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
      {children}
    </div>
  );
}