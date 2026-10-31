'use strict';

/**
 * 单元测试：错误码映射与统一响应（设计文档 §5.4、§5.2）
 * 需求追溯：REQ-NFR-11（统一错误响应）、REQ-NFR-14（可观测性）
 */
const { ApiError, fail, validationError, asyncHandler } = require('../../backend/src/utils/errors');
const { ERROR_CODES, ROLES, QUESTION_TYPES, SUBMIT_GRACE_SECONDS } = require('../../backend/src/config/constants');
const response = require('../../backend/src/utils/response');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('ApiError 错误码 → HTTP 状态映射', () => {
  test('TC-ERR-001 已定义业务码按错误码表映射（10101 → 401）', () => {
    const error = new ApiError(10101);
    expect(error.code).toBe(10101);
    expect(error.httpStatus).toBe(401);
    expect(error.message).toBe('用户名或密码错误');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
  });

  test('TC-ERR-002 支持自定义 message 与 httpStatus 覆盖', () => {
    const error = new ApiError(90409, { message: '自定义冲突', httpStatus: 422, data: { id: 1 } });
    expect(error.message).toBe('自定义冲突');
    expect(error.httpStatus).toBe(422);
    expect(error.data).toEqual({ id: 1 });
  });

  test('TC-ERR-003 未知业务码回退通用 500 语义但保留原始 code', () => {
    const error = new ApiError(99999);
    expect(error.code).toBe(99999);
    expect(error.httpStatus).toBe(500);
    expect(error.message).toBe(ERROR_CODES[90500].message);
  });

  test('TC-ERR-004 参数校验失败固定为 90101 / HTTP 422', () => {
    const error = validationError([{ field: 'email', message: '邮箱格式不合法' }]);
    expect(error.code).toBe(90101);
    expect(error.httpStatus).toBe(422);
    expect(error.errors).toEqual([{ field: 'email', message: '邮箱格式不合法' }]);
  });

  test('TC-ERR-005 fail 与 new ApiError 等价', () => {
    const error = fail(90301);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.httpStatus).toBe(403);
  });
});

describe('asyncHandler', () => {
  test('TC-ERR-010 异步异常交给 next，不产生未捕获拒绝', async () => {
    const next = jest.fn();
    const handler = asyncHandler(async () => { throw new Error('boom'); });
    await handler({}, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].message).toBe('boom');
  });

  test('TC-ERR-011 正常执行不调用 next', async () => {
    const next = jest.fn();
    const res = mockRes();
    const handler = asyncHandler(async (req, r) => { r.status(204).json(null); });
    await handler({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe('统一响应体', () => {
  test('TC-ERR-020 success 返回 { code:0, message:"ok", data }', () => {
    const res = mockRes();
    response.success(res, { id: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ code: 0, message: 'ok', data: { id: 1 } });
  });

  test('TC-ERR-021 created 使用 HTTP 201，accepted 使用 202', () => {
    const createdRes = mockRes();
    response.created(createdRes, { id: 2 });
    expect(createdRes.status).toHaveBeenCalledWith(201);

    const acceptedRes = mockRes();
    response.accepted(acceptedRes, { taskId: 3 });
    expect(acceptedRes.status).toHaveBeenCalledWith(202);
  });

  test('TC-ERR-022 page 组装分页字段与附加字段', () => {
    const res = mockRes();
    response.page(res, { list: [], total: 0, page: 1, pageSize: 20 }, { pendingCount: 2 });
    expect(res.json.mock.calls[0][0].data).toEqual({
      list: [], total: 0, page: 1, pageSize: 20, pendingCount: 2,
    });
  });

  test('TC-ERR-023 failure 输出业务码、错误明细与 HTTP 状态', () => {
    const res = mockRes();
    response.failure(res, { code: 90301, message: '无权访问该资源', errors: null }, 403);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      code: 90301, message: '无权访问该资源', errors: null, data: null,
    });
  });
});

describe('常量与错误码表完整性', () => {
  test('TC-ERR-030 所有错误码均为 5 位数字且 HTTP 状态合法', () => {
    const codes = Object.keys(ERROR_CODES);
    expect(codes.length).toBeGreaterThan(40);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9]{5}$/);
      const { http, message } = ERROR_CODES[code];
      expect([400, 401, 403, 404, 409, 422, 423, 429, 500, 503]).toContain(http);
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
  });

  test('TC-ERR-031 角色/题型/交卷宽限常量取值符合设计', () => {
    expect(ROLES).toEqual(['admin', 'teacher', 'student']);
    expect(QUESTION_TYPES).toEqual(['single', 'multiple', 'judge', 'fill', 'short']);
    expect(SUBMIT_GRACE_SECONDS).toBe(5);
  });
});