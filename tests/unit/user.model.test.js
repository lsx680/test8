'use strict';

/**
 * 单元测试：注册驳回 SQL 参数顺序（BUG-4 回归，数据层部分）
 * 需求追溯：REQ-UAM-06（注册审批：通过/驳回）、REQ-UAM-09（账号禁用）
 * 缺陷背景：修复前 SQL 占位符为 remark → id，但参数按 [id, reason] 传入，
 *          MySQL 报 "Truncated incorrect DOUBLE value: '<理由>'"，接口必现 500。
 *          修复后参数顺序为 [reason, id]，与占位符严格一致。
 * 说明：db 模块 mock，仅断言 SQL 与参数顺序，不连接数据库。
 */
const db = require('../../backend/src/config/db');
const userModel = require('../../backend/src/models/user.model');

jest.mock('../../backend/src/config/db');

const PENDING_ID = 9;
const REASON = '资料不完整，请补充学生证照片';

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ affectedRows: 1 });
});

describe('user.model.reject 参数顺序', () => {
  test('TC-UMD-001 驳回参数严格按 SQL 占位符顺序传入 [reason, id]', async () => {
    const affected = await userModel.reject(PENDING_ID, REASON);

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];

    // SQL：SET status='disabled', remark = ? WHERE id = ?
    const remarkPos = sql.indexOf('remark = ?');
    const idPos = sql.indexOf('WHERE id = ?');
    expect(remarkPos).toBeGreaterThan(-1);
    expect(idPos).toBeGreaterThan(remarkPos);

    expect(params).toEqual([REASON, PENDING_ID]);
    expect(params).toHaveLength(2);
  });

  test('TC-UMD-002 参数类型与占位符语义匹配：第 1 位为理由字符串、第 2 位为数值 id', async () => {
    await userModel.reject(PENDING_ID, REASON);

    const [, params] = db.query.mock.calls[0];
    expect(typeof params[0]).toBe('string');
    expect(params[0]).toBe(REASON);
    expect(typeof params[1]).toBe('number');
    expect(params[1]).toBe(PENDING_ID);
    // 回归守护：若退回旧顺序 [id, reason]，第 2 位将变成 string，本断言即失败
    expect(params[1]).not.toBe(REASON);
  });

  test('TC-UMD-003 驳回仅作用于 pending 未删除账号，更新计数透传', async () => {
    const affected = await userModel.reject(PENDING_ID, REASON);

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("status = 'disabled'");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('deleted_at IS NULL');
    expect(affected).toBe(1);
  });

  test('TC-UMD-004 状态不匹配（affectedRows=0）时返回 0，由服务层转 10110', async () => {
    db.query.mockResolvedValue({ affectedRows: 0 });

    const affected = await userModel.reject(PENDING_ID, REASON);

    expect(affected).toBe(0);
  });

  test('TC-UMD-005 审批通过仅使用 id 单参数（与驳回的参数形状区分）', async () => {
    await userModel.approve(PENDING_ID);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("status = 'active'");
    expect(params).toEqual([PENDING_ID]);
  });
});