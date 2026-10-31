'use strict';

/**
 * 单元测试：系统参数业务范围校验（BUG-5 回归）
 * 需求追溯：REQ-SYS-01（系统参数在线修改即时生效）、NFR-18（配置一致性）
 * 缺陷背景：修复前 config.service 仅校验「有限数字且非负」，70102 从不触发；
 *          修复后按 CONFIG_RULES 对 13 个参数做闭区间/枚举校验。
 * 说明：数据访问层（system.model / audit.model）全部 mock，不连接数据库。
 */
const systemModel = require('../../backend/src/models/system.model');
const auditModel = require('../../backend/src/models/audit.model');
const configService = require('../../backend/src/services/config.service');

jest.mock('../../backend/src/models/system.model');
jest.mock('../../backend/src/models/audit.model');

const OPERATOR_ID = 7;

/** 构造 findConfigByKey 的返回：默认是可编辑的数值参数 */
function mockConfig(configKey, overrides = {}) {
  const config = {
    id: 1,
    configKey,
    configValue: '5',
    valueType: 'number',
    configGroup: 'security',
    isEditable: 1,
    ...overrides,
  };
  systemModel.findConfigByKey.mockResolvedValue(config);
  return config;
}

beforeEach(() => {
  jest.clearAllMocks();
  configService.invalidate(); // 清除上一用例的进程内缓存
  systemModel.updateConfigValue.mockResolvedValue(1);
  auditModel.write.mockResolvedValue(true);
});

describe('数值参数闭区间校验（security.maxLoginFail 1~10）', () => {
  test.each([
    ['TC-CFG-001', 0],
    ['TC-CFG-002', 11],
    ['TC-CFG-003', -1],
    ['TC-CFG-004', 9999],
  ])('%s maxLoginFail=%p 越界返回 70102 且不落库', async (tc, value) => {
    mockConfig('security.maxLoginFail');

    await expect(configService.update('security.maxLoginFail', value, OPERATOR_ID))
      .rejects.toMatchObject({
        code: 70102,
        httpStatus: 400,
        message: expect.stringContaining('取值范围为 1~10'),
      });
    expect(systemModel.updateConfigValue).not.toHaveBeenCalled();
    expect(auditModel.write).not.toHaveBeenCalled();
  });

  test.each([
    ['TC-CFG-010', 1],
    ['TC-CFG-011', 5],
    ['TC-CFG-012', 10],
  ])('%s maxLoginFail=%p 处于闭区间内放行并以字符串落库', async (tc, value) => {
    mockConfig('security.maxLoginFail');

    await configService.update('security.maxLoginFail', value, OPERATOR_ID);

    expect(systemModel.updateConfigValue).toHaveBeenCalledWith(
      'security.maxLoginFail',
      String(value),
      OPERATOR_ID,
    );
    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({
      module: 'sys',
      action: 'config.update',
      result: 'success',
      requestSummary: expect.objectContaining({
        configKey: 'security.maxLoginFail',
        newValue: String(value),
      }),
    }));
  });

  test.each([
    ['TC-CFG-013', 0],
    ['TC-CFG-014', 1441],
    ['TC-CFG-015', -30],
  ])('%s lockMinutes=%p 越界返回 70102', async (tc, value) => {
    mockConfig('security.lockMinutes', { configValue: '15' });

    await expect(configService.update('security.lockMinutes', value, OPERATOR_ID))
      .rejects.toMatchObject({ code: 70102, message: expect.stringContaining('1~1440') });
  });

  test.each([
    ['TC-CFG-016', 1],
    ['TC-CFG-017', 1440],
  ])('%s lockMinutes=%p 边界值放行', async (tc, value) => {
    mockConfig('security.lockMinutes', { configValue: '15' });

    await configService.update('security.lockMinutes', value, OPERATOR_ID);

    expect(systemModel.updateConfigValue).toHaveBeenCalledWith('security.lockMinutes', String(value), OPERATOR_ID);
  });

  test('TC-CFG-018 整数参数传入小数返回 70102（非整数）', async () => {
    mockConfig('security.maxLoginFail');

    await expect(configService.update('security.maxLoginFail', 5.5, OPERATOR_ID))
      .rejects.toMatchObject({ code: 70102, message: expect.stringContaining('必须为整数') });
  });

  test('TC-CFG-019 非数字字符串返回 70102（必须为数字）', async () => {
    mockConfig('security.maxLoginFail');

    await expect(configService.update('security.maxLoginFail', 'abc', OPERATOR_ID))
      .rejects.toMatchObject({ code: 70102, message: '参数值必须为数字' });
  });

  test('TC-CFG-020 小数参数按 number 规则校验区间（grading.arbitrationThresholdRatio 0~1）', async () => {
    mockConfig('grading.arbitrationThresholdRatio', { valueType: 'number', configGroup: 'grading' });

    await expect(configService.update('grading.arbitrationThresholdRatio', 1.2, OPERATOR_ID))
      .rejects.toMatchObject({ code: 70102, message: expect.stringContaining('0~1') });

    await configService.update('grading.arbitrationThresholdRatio', 0.2, OPERATOR_ID);
    expect(systemModel.updateConfigValue).toHaveBeenCalledWith(
      'grading.arbitrationThresholdRatio',
      '0.2',
      OPERATOR_ID,
    );
  });

  test('TC-CFG-021 无规则的自定义数值参数仍禁止负数（兜底分支）', async () => {
    mockConfig('custom.threshold', { configValue: '10' });

    await expect(configService.update('custom.threshold', -1, OPERATOR_ID))
      .rejects.toMatchObject({ code: 70102, message: '参数值不能为负数' });
  });
});

describe('枚举参数白名单校验（grading.multiChoiceStrategy）', () => {
  test.each([
    ['TC-CFG-030', 'all_or_nothing'],
    ['TC-CFG-031', 'half_score'],
  ])('%s 枚举值 %s 合法放行', async (tc, value) => {
    mockConfig('grading.multiChoiceStrategy', { valueType: 'string', configValue: 'all_or_nothing' });

    await configService.update('grading.multiChoiceStrategy', value, OPERATOR_ID);

    expect(systemModel.updateConfigValue).toHaveBeenCalledWith(
      'grading.multiChoiceStrategy',
      value,
      OPERATOR_ID,
    );
  });

  test.each([
    ['TC-CFG-032', 'average_score'],
    ['TC-CFG-033', ''],
    ['TC-CFG-034', 'ALL_OR_NOTHING'],
  ])('%s 枚举非法值 %p 返回 70102 并列出白名单', async (tc, value) => {
    mockConfig('grading.multiChoiceStrategy', { valueType: 'string', configValue: 'all_or_nothing' });

    await expect(configService.update('grading.multiChoiceStrategy', value, OPERATOR_ID))
      .rejects.toMatchObject({
        code: 70102,
        message: expect.stringContaining('all_or_nothing/half_score'),
      });
    expect(systemModel.updateConfigValue).not.toHaveBeenCalled();
  });
});

describe('boolean / json 参数校验', () => {
  test('TC-CFG-040 boolean 参数仅接受 true/false 字符串', async () => {
    mockConfig('exam.allowResubmit', { valueType: 'boolean', configValue: 'false' });

    await expect(configService.update('exam.allowResubmit', 'yes', OPERATOR_ID))
      .rejects.toMatchObject({ code: 70102, message: '参数值必须为 true/false' });

    await configService.update('exam.allowResubmit', true, OPERATOR_ID);
    expect(systemModel.updateConfigValue).toHaveBeenCalledWith('exam.allowResubmit', 'true', OPERATOR_ID);
  });

  test('TC-CFG-041 json 参数非法 JSON 返回 70102', async () => {
    mockConfig('exam.noticeTemplate', { valueType: 'json', configValue: '{}' });

    await expect(configService.update('exam.noticeTemplate', '{"a":', OPERATOR_ID))
      .rejects.toMatchObject({ code: 70102, message: '参数值必须为合法 JSON' });
  });

  test('TC-CFG-042 json 参数合法 JSON 放行', async () => {
    mockConfig('exam.noticeTemplate', { valueType: 'json', configValue: '{}' });

    await configService.update('exam.noticeTemplate', '{"title":"考试通知"}', OPERATOR_ID);

    expect(systemModel.updateConfigValue).toHaveBeenCalledWith(
      'exam.noticeTemplate',
      '{"title":"考试通知"}',
      OPERATOR_ID,
    );
  });
});

describe('修改前置条件', () => {
  test('TC-CFG-050 参数不存在返回 90401（404）', async () => {
    systemModel.findConfigByKey.mockResolvedValue(null);

    await expect(configService.update('not.exist', 1, OPERATOR_ID))
      .rejects.toMatchObject({ code: 90401, httpStatus: 404 });
    expect(systemModel.updateConfigValue).not.toHaveBeenCalled();
  });

  test('TC-CFG-051 只读参数（isEditable=0）返回 70101，优先于范围校验', async () => {
    mockConfig('security.bcryptCost', { isEditable: 0, configValue: '10' });

    await expect(configService.update('security.bcryptCost', 12, OPERATOR_ID))
      .rejects.toMatchObject({
        code: 70101,
        httpStatus: 403,
        message: expect.stringContaining('不允许在线修改'),
      });
    expect(systemModel.updateConfigValue).not.toHaveBeenCalled();
  });

  test('TC-CFG-052 修改成功写入新值与原因，并返回刷新后的参数记录', async () => {
    mockConfig('security.maxLoginFail', { configValue: '5' });

    const updated = await configService.update('security.maxLoginFail', 8, OPERATOR_ID, '安全加固');

    expect(systemModel.findConfigByKey).toHaveBeenNthCalledWith(2, 'security.maxLoginFail');
    expect(updated).toEqual(expect.objectContaining({ configKey: 'security.maxLoginFail' }));
    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({
      userId: OPERATOR_ID,
      requestSummary: expect.objectContaining({
        oldValue: '5',
        newValue: '8',
        reason: '安全加固',
      }),
    }));
  });
});

describe('参数读取缓存与默认值兜底', () => {
  test('TC-CFG-060 60 秒内重复读取命中进程内缓存，仅查库一次', async () => {
    systemModel.listConfigs.mockResolvedValue([
      { configKey: 'security.maxLoginFail', configValue: '9' },
    ]);

    expect(await configService.get('security.maxLoginFail')).toBe('9');
    expect(await configService.get('security.maxLoginFail')).toBe('9');

    expect(systemModel.listConfigs).toHaveBeenCalledTimes(1);
  });

  test('TC-CFG-061 修改参数后缓存失效，下次读取重新查库并拿到新值', async () => {
    systemModel.listConfigs.mockResolvedValue([
      { configKey: 'security.maxLoginFail', configValue: '9' },
    ]);
    mockConfig('security.maxLoginFail', { configValue: '9' });

    expect(await configService.get('security.maxLoginFail')).toBe('9');
    await configService.update('security.maxLoginFail', 3, OPERATOR_ID);
    expect(await configService.get('security.maxLoginFail')).toBe('9');

    expect(systemModel.listConfigs).toHaveBeenCalledTimes(2);
  });

  test('TC-CFG-062 数据库无该键时回退 DEFAULT_CONFIGS 默认值', async () => {
    systemModel.listConfigs.mockResolvedValue([]);

    expect(await configService.get('security.maxLoginFail')).toBe('5');
  });

  test('TC-CFG-063 getNumber 对非法存储值兜底为默认数值', async () => {
    systemModel.listConfigs.mockResolvedValue([
      { configKey: 'security.maxLoginFail', configValue: 'not-a-number' },
    ]);

    expect(await configService.getNumber('security.maxLoginFail')).toBe(5);
  });

  test('TC-CFG-064 getNumber 正常解析数值字符串', async () => {
    systemModel.listConfigs.mockResolvedValue([
      { configKey: 'security.lockMinutes', configValue: '30' },
    ]);

    const value = await configService.getNumber('security.lockMinutes');

    expect(value).toBe(30);
    expect(typeof value).toBe('number');
  });
});