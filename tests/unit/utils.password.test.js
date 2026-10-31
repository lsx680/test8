'use strict';

/**
 * 单元测试：密码工具（REQ-UAM-05 密码策略、REQ-UAM-07 改密、REQ-NFR-06 安全存储）
 * 覆盖：bcrypt 加盐哈希、校验、强度规则、一次性临时密码
 */
const {
  hashPassword,
  comparePassword,
  isStrongPassword,
  generateTemporaryPassword,
} = require('../../backend/src/utils/password');

describe('密码哈希与校验', () => {
  test('TC-PWD-001 同一密码两次哈希结果不同（随机盐）', async () => {
    const hash1 = await hashPassword('Passw0rd');
    const hash2 = await hashPassword('Passw0rd');
    expect(hash1).not.toBe(hash2);
    expect(hash1.startsWith('$2')).toBe(true);
  });

  test('TC-PWD-002 正确密码校验通过', async () => {
    const hash = await hashPassword('Passw0rd');
    await expect(comparePassword('Passw0rd', hash)).resolves.toBe(true);
  });

  test('TC-PWD-003 错误密码校验失败', async () => {
    const hash = await hashPassword('Passw0rd');
    await expect(comparePassword('passw0rd', hash)).resolves.toBe(false);
    await expect(comparePassword('', hash)).resolves.toBe(false);
  });
});

describe('密码强度规则', () => {
  test('TC-PWD-010 合法密码（8 位、大小写字母 + 数字）', () => {
    expect(isStrongPassword('Abcdef12')).toBe(true);
    expect(isStrongPassword('A1b2C3d4E5f6')).toBe(true);
  });

  test('TC-PWD-011 缺少大写 / 小写 / 数字均不合法', () => {
    expect(isStrongPassword('abcdef12')).toBe(false);
    expect(isStrongPassword('ABCDEF12')).toBe(false);
    expect(isStrongPassword('Abcdefgh')).toBe(false);
  });

  test('TC-PWD-012 长度不足 8 位不合法', () => {
    expect(isStrongPassword('Abc1234')).toBe(false);
  });

  test('TC-PWD-013 超过 64 位不合法', () => {
    expect(isStrongPassword(`Aa1${'x'.repeat(62)}`)).toBe(false);
  });

  test('TC-PWD-014 非字符串输入不合法', () => {
    expect(isStrongPassword(null)).toBe(false);
    expect(isStrongPassword(12345678)).toBe(false);
  });
});

describe('一次性临时密码', () => {
  test('TC-PWD-020 默认长度 12 且同时包含大写/小写/数字/符号', () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(12);
    expect(/[A-Z]/u.test(password)).toBe(true);
    expect(/[a-z]/u.test(password)).toBe(true);
    expect(/[0-9]/u.test(password)).toBe(true);
    expect(/[@#$%&*]/u.test(password)).toBe(true);
  });

  test('TC-PWD-021 自定义长度仍满足四类字符要求', () => {
    for (const length of [8, 16, 32]) {
      const password = generateTemporaryPassword(length);
      // 实现保证四类字符优先放入，最终长度不小于请求长度
      expect(password.length).toBeGreaterThanOrEqual(length);
      expect(/[A-Z]/u.test(password)).toBe(true);
      expect(/[a-z]/u.test(password)).toBe(true);
      expect(/[0-9]/u.test(password)).toBe(true);
      expect(/[@#$%&*]/u.test(password)).toBe(true);
    }
  });

  test('TC-PWD-022 连续生成不重复（随机性）', () => {
    const list = new Set(Array.from({ length: 20 }, () => generateTemporaryPassword()));
    expect(list.size).toBe(20);
  });
});