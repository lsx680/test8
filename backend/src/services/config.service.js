'use strict';

/**
 * 系统参数服务：进程内缓存 60s，修改后主动失效，保证“即时生效”（REQ-SYS-01）
 */
const systemModel = require('../models/system.model');
const { DEFAULT_CONFIGS } = require('../config/constants');
const { fail } = require('../utils/errors');

let cache = null;
let expiresAt = 0;
const TTL_MS = 60 * 1000;

/**
 * 业务范围校验规则（REQ-SYS-01）
 * 数值参数给出闭区间；字符串枚举参数给出白名单，避免把业务参数改成不可用值
 */
const CONFIG_RULES = {
  'exam.defaultDuration': { type: 'integer', min: 1, max: 480 },
  'exam.passScore': { type: 'number', min: 0, max: 1000 },
  'exam.autosaveIntervalSeconds': { type: 'integer', min: 5, max: 600 },
  'exam.antiCheatThreshold': { type: 'integer', min: 1, max: 100 },
  'security.accessTokenTtlSeconds': { type: 'integer', min: 60, max: 86400 },
  'security.refreshTokenTtlSeconds': { type: 'integer', min: 300, max: 2592000 },
  'security.maxLoginFail': { type: 'integer', min: 1, max: 10 },
  'security.lockMinutes': { type: 'integer', min: 1, max: 1440 },
  'security.bcryptCost': { type: 'integer', min: 10, max: 14 },
  'grading.multiChoiceStrategy': { type: 'enum', values: ['all_or_nothing', 'half_score'] },
  'grading.arbitrationThresholdRatio': { type: 'number', min: 0, max: 1 },
  'system.appealWindowDays': { type: 'integer', min: 0, max: 365 },
  'system.auditRetentionDays': { type: 'integer', min: 1, max: 3650 },
};

async function load({ force = false } = {}) {
  if (!force && cache && expiresAt > Date.now()) return cache;
  const rows = await systemModel.listConfigs();
  const map = new Map(Object.entries(DEFAULT_CONFIGS));
  for (const row of rows) map.set(row.configKey, row.configValue);
  cache = map;
  expiresAt = Date.now() + TTL_MS;
  return cache;
}

async function get(key) {
  const map = await load();
  return map.has(key) ? map.get(key) : DEFAULT_CONFIGS[key];
}

async function getNumber(key) {
  const value = Number(await get(key));
  return Number.isFinite(value) ? value : Number(DEFAULT_CONFIGS[key]);
}

function invalidate() {
  cache = null;
  expiresAt = 0;
}

async function list(group) {
  return systemModel.listConfigs(group);
}

/**
 * 修改参数：is_editable=0 拒绝；按 value_type 校验取值范围
 */
async function update(configKey, configValue, userId, reason) {
  const config = await systemModel.findConfigByKey(configKey);
  if (!config) throw fail(90401);
  if (!config.isEditable) throw fail(70101, { message: `参数 ${configKey} 不允许在线修改` });

  const rule = CONFIG_RULES[configKey];
  if (config.valueType === 'number') {
    const n = Number(configValue);
    if (!Number.isFinite(n)) throw fail(70102, { message: '参数值必须为数字' });
    if (rule && rule.type === 'integer' && !Number.isInteger(n)) {
      throw fail(70102, { message: `参数 ${configKey} 必须为整数` });
    }
    if (rule && (n < rule.min || n > rule.max)) {
      throw fail(70102, { message: `参数 ${configKey} 取值范围为 ${rule.min}~${rule.max}` });
    }
    if (!rule && n < 0) throw fail(70102, { message: '参数值不能为负数' });
  } else if (config.valueType === 'string' && rule && rule.type === 'enum') {
    if (!rule.values.includes(String(configValue))) {
      throw fail(70102, { message: `参数 ${configKey} 仅允许取值：${rule.values.join('/')}` });
    }
  } else if (config.valueType === 'boolean') {
    if (!['true', 'false'].includes(String(configValue))) throw fail(70102, { message: '参数值必须为 true/false' });
  } else if (config.valueType === 'json') {
    try {
      JSON.parse(configValue);
    } catch (err) {
      throw fail(70102, { message: '参数值必须为合法 JSON' });
    }
  }

  await systemModel.updateConfigValue(configKey, String(configValue), userId);
  invalidate();

  // 修改记录同时写入审计（reason 进入摘要）
  const auditModel = require('../models/audit.model');
  await auditModel.write({
    userId,
    module: 'sys',
    action: 'config.update',
    requestSummary: { configKey, oldValue: config.configValue, newValue: String(configValue), reason: reason || null },
    result: 'success',
  });
  return systemModel.findConfigByKey(configKey);
}

module.exports = { get, getNumber, load, invalidate, list, update };