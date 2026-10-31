/**
 * 原生 SVG 柱状图（零图表依赖，REQ-STA-07）
 * data: [{ label: '90-100', value: 12, hint?: '12 人' }]
 */
import { useId } from 'react';

export default function BarChart({
  data = [],
  height = 240,
  color = '#0e7490',
  accent = '#7c3aed',
  valueFormatter = (v) => String(v),
  yMax,
  emptyText = '暂无统计数据',
}) {
  const gradientId = useId().replace(/:/g, '');
  if (!data.length) {
    return <div className="dash-empty">{emptyText}</div>;
  }

  const width = 720;
  const padding = { top: 18, right: 16, bottom: 38, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxValue = Math.max(yMax || 0, ...data.map((d) => Number(d.value) || 0), 1);
  const slot = innerW / data.length;
  const barW = Math.min(64, slot * 0.56);
  const ticks = 4;

  const y = (value) => padding.top + innerH - (Number(value) / maxValue) * innerH;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="分数段分布柱状图"
    >
      <defs>
        <linearGradient id={`bar-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* 网格线与 y 轴刻度 */}
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const value = (maxValue / ticks) * i;
        const yy = y(value);
        return (
          <g key={`tick-${i}`}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yy}
              y2={yy}
              stroke="rgba(148,163,184,0.35)"
              strokeDasharray={i === 0 ? '0' : '4 5'}
            />
            <text
              x={padding.left - 8}
              y={yy + 4}
              textAnchor="end"
              fontSize="11"
              fill="#52627a"
            >
              {Number.isInteger(value) ? value : value.toFixed(1)}
            </text>
          </g>
        );
      })}

      {/* 柱体 */}
      {data.map((item, index) => {
        const value = Number(item.value) || 0;
        const barH = Math.max(0, padding.top + innerH - y(value));
        const xx = padding.left + slot * index + (slot - barW) / 2;
        return (
          <g key={item.label || index}>
            <rect
              className="chart-bar"
              x={xx}
              y={y(value)}
              width={barW}
              height={barH}
              rx="4"
              fill={`url(#bar-${gradientId})`}
            >
              <title>{`${item.label}：${valueFormatter(value)}`}</title>
            </rect>
            <text
              x={xx + barW / 2}
              y={y(value) - 6}
              textAnchor="middle"
              fontSize="11"
              fill="#0f172a"
              fontWeight="600"
            >
              {valueFormatter(value)}
            </text>
            <text
              x={xx + barW / 2}
              y={height - 14}
              textAnchor="middle"
              fontSize="11"
              fill="#52627a"
            >
              {item.label}
            </text>
          </g>
        );
      })}

      {/* 坐标轴 */}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={padding.top + innerH}
        y2={padding.top + innerH}
        stroke="rgba(82,98,122,0.5)"
      />
    </svg>
  );
}