'use strict';

/**
 * 单元测试：JWT 工具（REQ-UAM-03 令牌签发与校验、REQ-UAM-04 刷新令牌轮换）
 * 覆盖：签发、验签、类型隔离、篡改、过期、Bearer 解析、摘要计算
 */
const jsonwebtoken = require('../../backend/node_modules/jsonwebtoken');
const env = require('../../backend/src/config/env');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  extractBearer,
  sha256,
} = require('../../backend/src/utils/jwt');

const USER = { id: 7, username: 'S2024007', role_code: 'student', token_version: 3 };

describe('JWT 签发与校验', () => {
  test('TC-JWT-001 Access Token 载荷包含 sub/username/roleCode/tokenVersion/type/jti', () => {
    const { token, jti, expiresIn } = signAccessToken(USER);
    expect(typeof token).toBe('string');
    expect(jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresIn).toBe(env.jwtExpiresIn);

    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('7');
    expect(payload.username).toBe('S2024007');
    expect(payload.roleCode).toBe('student');
    expect(payload.tokenVersion).toBe(3);
    expect(payload.type).toBe('access');
    expect(payload.jti).toBe(jti);
  });

  test('TC-JWT-002 兼容 camelCase 形式的 tokenVersion', () => {
    const { token } = signAccessToken({ id: 9, username: 'x', roleCode: 'teacher', tokenVersion: 12 });
    expect(verifyAccessToken(token).tokenVersion).toBe(12);
  });

  test('TC-JWT-003 Refresh Token 载荷仅含 sub/type/jti', () => {
    const { token, jti } = signRefreshToken(USER);
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('7');
    expect(payload.type).toBe('refresh');
    expect(payload.jti).toBe(jti);
    expect(payload.username).toBeUndefined();
  });

  test('TC-JWT-004 篡改 Token 抛 90202（401）', () => {
    const { token } = signAccessToken(USER);
    const tampered = `${token.slice(0, -2)}xx`;
    expect(() => verifyAccessToken(tampered)).toThrow(expect.objectContaining({ code: 90202, httpStatus: 401 }));
  });

  test('TC-JWT-005 使用错误密钥签发视为无效（90202）', () => {
    const forged = jsonwebtoken.sign(
      { sub: '7', type: 'access', tokenVersion: 3, jti: 'forged' },
      'another-secret',
      { algorithm: 'HS256' },
    );
    expect(() => verifyAccessToken(forged)).toThrow(expect.objectContaining({ code: 90202 }));
  });

  test('TC-JWT-006 Access Token 过期抛 90203（401）', () => {
    const expired = jsonwebtoken.sign(
      { sub: '7', type: 'access', tokenVersion: 3, jti: 'expired' },
      env.jwtSecret,
      { algorithm: 'HS256', expiresIn: -10 },
    );
    expect(() => verifyAccessToken(expired)).toThrow(expect.objectContaining({ code: 90203, httpStatus: 401 }));
  });

  test('TC-JWT-007 Refresh Token 过期抛 10109（401）', () => {
    const expired = jsonwebtoken.sign(
      { sub: '7', type: 'refresh', jti: 'expired-refresh' },
      env.jwtSecret,
      { algorithm: 'HS256', expiresIn: -10 },
    );
    expect(() => verifyRefreshToken(expired)).toThrow(expect.objectContaining({ code: 10109, httpStatus: 401 }));
  });

  test('TC-JWT-008 Access Token 不可当作 Refresh Token 使用（类型隔离）', () => {
    const { token } = signAccessToken(USER);
    expect(() => verifyRefreshToken(token)).toThrow(expect.objectContaining({ code: 10109 }));
  });

  test('TC-JWT-009 Refresh Token 不可当作 Access Token 使用（类型隔离）', () => {
    const { token } = signRefreshToken(USER);
    expect(() => verifyAccessToken(token)).toThrow(expect.objectContaining({ code: 90202 }));
  });

  test('TC-JWT-010 缺少 sub 的 Access Token 视为无效', () => {
    const token = jsonwebtoken.sign({ type: 'access', jti: 'no-sub' }, env.jwtSecret, { algorithm: 'HS256' });
    expect(() => verifyAccessToken(token)).toThrow(expect.objectContaining({ code: 90202 }));
  });

  test('TC-JWT-011 缺少 jti 的 Refresh Token 视为无效', () => {
    const token = jsonwebtoken.sign({ sub: '7', type: 'refresh' }, env.jwtSecret, { algorithm: 'HS256' });
    expect(() => verifyRefreshToken(token)).toThrow(expect.objectContaining({ code: 10109 }));
  });
});

describe('Bearer 解析与摘要', () => {
  test('TC-JWT-020 正常解析 Bearer 头（方案名大小写不敏感）', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearer('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearer('BEARER abc.def.ghi')).toBe('abc.def.ghi');
    // 实现的 token 去首尾空格逻辑：'Bearer  token ' 允许尾部空格
    expect(extractBearer('Bearer abc.def.ghi ')).toBe('abc.def.ghi');
  });

  test('TC-JWT-020b 非标准的多空格分隔不被接受（严格遵守 RFC 6750 单空格）', () => {
    // 观察项：Authorization: "Bearer  <token>"（两个空格）解析失败 → 401，
    // 前端 axios 生成的头固定为单空格，不会触发；此处如实记录实现行为。
    expect(extractBearer('Bearer  abc.def.ghi')).toBeNull();
  });

  test('TC-JWT-021 缺失/格式错误/非字符串返回 null', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('')).toBeNull();
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer(12345)).toBeNull();
  });

  test('TC-JWT-022 sha256 输出稳定 64 位十六进制', () => {
    const digest = sha256('refresh-token-value');
    expect(digest).toHaveLength(64);
    expect(digest).toBe(sha256('refresh-token-value'));
    expect(digest).not.toBe(sha256('refresh-token-value2'));
  });
});