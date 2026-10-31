/**
 * 通用格式化工具
 * 约定：后端时间字段均为 ISO 8601（UTC），前端统一按本地时区展示。
 */

/** 补零 */
const pad = (n) => String(n).padStart(2, '0');

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 2026-10-31 09:30:00 */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

/** 2026-10-31 */
export function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** HH:mm:ss（暂存时间提示） */
export function formatClock(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** datetime-local 输入控件需要的本地时间字符串 */
export function toDateTimeLocal(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** datetime-local 值转 ISO（datetime-local 无时区，按本地时区解释） */
export function fromDateTimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 秒数 → mm:ss / hh:mm:ss */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 分钟 → 中文时长 */
export function formatMinutes(minutes) {
  const m = Number(minutes) || 0;
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分钟` : `${h} 小时`;
}

/** 分数统一保留 1 位小数（整数不补 .0） */
export function formatScore(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 比例（0~1 或 0~100 的入参需自行换算）→ 百分比字符串 */
export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(digits).replace(/\.0$/, '')}%`;
}

/** 文件大小 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 文本截断 */
export function truncate(text, max = 40) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 数组 → 逗号分隔字符串（答案展示） */
export function displayAnswer(answer) {
  if (answer === null || answer === undefined) return '未作答';
  if (Array.isArray(answer)) {
    if (answer.length === 0) return '未作答';
    return answer.map((v) => (v === 'true' ? '正确' : v === 'false' ? '错误' : String(v))).join('、');
  }
  return String(answer);
}

/** 组合 className */
export function cx(...args) {
  return args.filter(Boolean).join(' ');
}

/** 从分页响应中提取 list（兼容 {list,total} 与裸数组） */
export function listOf(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.list ?? [];
}

/** 触发浏览器下载（配合 blob 响应） */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟释放，避免部分浏览器下载被中断
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** 简易设备指纹（仅用于多端登录检测，不含隐私信息） */
export function getDeviceKey() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
  ].join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `web-${hash.toString(36)}`;
}