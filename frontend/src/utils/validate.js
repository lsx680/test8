/**
 * 表单校验工具
 * 所有校验函数返回 null（通过）或中文错误文案；页面据此做 inline 提示。
 */

export const PATTERNS = {
  username: /^[A-Za-z0-9_-]{4,32}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/,
  phone: /^[0-9+\-\s()]{6,32}$/,
};

export function required(value, label = '该项') {
  if (value === null || value === undefined) return `${label}不能为空`;
  if (typeof value === 'string' && value.trim() === '') return `${label}不能为空`;
  if (Array.isArray(value) && value.length === 0) return `${label}不能为空`;
  return null;
}

export function minLen(value, min, label = '该项') {
  if (!value) return null;
  return String(value).length < min ? `${label}长度不能少于 ${min} 个字符` : null;
}

export function maxLen(value, max, label = '该项') {
  if (!value) return null;
  return String(value).length > max ? `${label}长度不能超过 ${max} 个字符` : null;
}

export function email(value, label = '邮箱') {
  if (!value) return null;
  return PATTERNS.email.test(String(value).trim()) ? null : `${label}格式不正确`;
}

export function username(value) {
  if (!value) return '学号/工号不能为空';
  return PATTERNS.username.test(String(value).trim())
    ? null
    : '账号需为 4~32 位字母、数字、下划线或短横线';
}

export function password(value, label = '密码') {
  if (!value) return `${label}不能为空`;
  return PATTERNS.password.test(String(value))
    ? null
    : `${label}需不少于 8 位，且同时包含大小写字母与数字`;
}

export function confirmPassword(value, original) {
  if (!value) return '请再次输入密码';
  return value === original ? null : '两次输入的密码不一致';
}

export function numberRange(value, min, max, label = '数值') {
  if (value === null || value === undefined || value === '') return `${label}不能为空`;
  const n = Number(value);
  if (Number.isNaN(n)) return `${label}必须为数字`;
  if (min !== undefined && n < min) return `${label}不能小于 ${min}`;
  if (max !== undefined && n > max) return `${label}不能大于 ${max}`;
  return null;
}

export function integerRange(value, min, max, label = '数值') {
  const base = numberRange(value, min, max, label);
  if (base) return base;
  return Number.isInteger(Number(value)) ? null : `${label}必须为整数`;
}

/**
 * 批量校验：rules 形如 { field: [fn, ...] }
 * 返回 { errors, valid }
 */
export function runRules(values, rules) {
  const errors = {};
  Object.entries(rules).forEach(([field, fns]) => {
    for (const fn of fns) {
      const msg = fn(values?.[field], values);
      if (msg) {
        errors[field] = msg;
        break;
      }
    }
  });
  return { errors, valid: Object.keys(errors).length === 0 };
}

/** 将后端 422 的 errors（[{field,message}]）转为字段错误对象 */
export function mapServerErrors(errors = []) {
  const result = {};
  (errors || []).forEach((item) => {
    if (item?.field && !result[item.field]) result[item.field] = item.message;
  });
  return result;
}

/** 密码强度评分（0~4），用于登录/注册页提示 */
export function passwordStrength(value = '') {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return score;
}