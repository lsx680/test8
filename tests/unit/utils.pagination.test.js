'use strict';

/**
 * 单元测试：分页参数规范化（设计文档 §5.3；列表类接口通用）
 */
const { parsePagination, pageResult } = require('../../backend/src/utils/pagination');

describe('parsePagination', () => {
  test('TC-PAG-001 缺省参数默认为第 1 页、每页 20 条', () => {
    expect(parsePagination()).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 });
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 });
  });

  test('TC-PAG-002 正常分页参数计算 offset', () => {
    expect(parsePagination({ page: '3', pageSize: '10' }))
      .toEqual({ page: 3, pageSize: 10, offset: 20, limit: 10 });
  });

  test('TC-PAG-003 page 非法（0 / 负数 / 非数字）自动回退为 1', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1);
    expect(parsePagination({ page: '-5' }).page).toBe(1);
    expect(parsePagination({ page: 'abc' }).page).toBe(1);
  });

  test('TC-PAG-004 page 超过上限 1000 时截断', () => {
    expect(parsePagination({ page: '999999' }).page).toBe(1000);
  });

  test('TC-PAG-005 pageSize 非法（0 / 负数 / 非数字）回退为默认 20', () => {
    expect(parsePagination({ pageSize: '0' }).pageSize).toBe(20);
    expect(parsePagination({ pageSize: '-1' }).pageSize).toBe(20);
    expect(parsePagination({ pageSize: 'x' }).pageSize).toBe(20);
  });

  test('TC-PAG-006 pageSize 超过上限 100 时截断', () => {
    expect(parsePagination({ pageSize: '1000' })).toEqual({ page: 1, pageSize: 100, offset: 0, limit: 100 });
  });

  test('TC-PAG-007 小数参数按整数解析', () => {
    expect(parsePagination({ page: '2.9', pageSize: '15.8' })).toEqual({ page: 2, pageSize: 15, offset: 15, limit: 15 });
  });
});

describe('pageResult', () => {
  test('TC-PAG-010 组装分页响应并将 total 转数值', () => {
    const result = pageResult([{ id: 1 }], '3', { page: 1, pageSize: 20 });
    expect(result).toEqual({ list: [{ id: 1 }], total: 3, page: 1, pageSize: 20 });
  });

  test('TC-PAG-011 total 非法值兜底为 0', () => {
    expect(pageResult([], null, { page: 1, pageSize: 20 }).total).toBe(0);
    expect(pageResult([], undefined, { page: 1, pageSize: 20 }).total).toBe(0);
  });

  test('TC-PAG-012 支持附加统计字段', () => {
    const result = pageResult([], 0, { page: 2, pageSize: 5 }, { pendingCount: 7 });
    expect(result.pendingCount).toBe(7);
    expect(result.page).toBe(2);
  });
});