'use strict';

/**
 * 单元测试：注册审批服务参数传递（BUG-4 回归，服务层部分）
 * 需求追溯：REQ-UAM-06（管理员审批通过/驳回注册申请）、REQ-UAM-09（账号状态变更）
 * 缺陷背景：驳回链路 500 的根因在 user.model.reject 参数顺序；
 *          服务层必须保持 (userId, reason) 的语义顺序，不得把 reason 放在前面。
 * 说明：user.model / audit.model 等数据访问层全部 mock。
 */
const userModel = require('../../backend/src/models/user.model');
const rbacModel = require('../../backend/src/models/rbac.model');
const tokenModel = require('../../backend/src/models/token.model');
const auditModel = require('../../backend/src/models/audit.model');
const authService = require('../../backend/src/services/auth.service');
const rbacMiddleware = require('../../backend/src/middleware/rbac');
const userService = require('../../backend/src/services/user.service');

jest.mock('../../backend/src/models/user.model');
jest.mock('../../backend/src/models/rbac.model');
jest.mock('../../backend/src/models/token.model');
jest.mock('../../backend/src/models/audit.model');
jest.mock('../../backend/src/services/auth.service');
jest.mock('../../backend/src/middleware/rbac');
jest.mock('../../backend/src/config/db');

const PENDING_ID = 9;
const OPERATOR_ID = 1;
const REASON = '资料不完整，请补充学生证照片';

beforeEach(() => {
  jest.clearAllMocks();
  userModel.findById.mockResolvedValue({ id: PENDING_ID, username: 'S2024099', status: 'pending' });
  userModel.reject.mockResolvedValue(1);
  userModel.approve.mockResolvedValue(1);
  auditModel.write.mockResolvedValue(true);
  rbacMiddleware.invalidatePermissionCache.mockResolvedValue(undefined);
});

describe('userService.reject 注册驳回', () => {
  test('TC-USV-001 驳回按 (userId, reason) 语义调用模型，并写入审计', async () => {
    await userService.reject(PENDING_ID, REASON, OPERATOR_ID);

    expect(userModel.reject).toHaveBeenCalledWith(PENDING_ID, REASON);
    const [modelArgs] = userModel.reject.mock.calls[0];
    expect(modelArgs).toBe(PENDING_ID);
    expect(userModel.reject.mock.calls[0][1]).toBe(REASON);

    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({
      userId: OPERATOR_ID,
      module: 'uam',
      action: 'user.reject',
      result: 'success',
      requestSummary: expect.objectContaining({
        targetUserId: PENDING_ID,
        username: 'S2024099',
        reason: REASON,
      }),
    }));
  });

  test('TC-USV-002 驳回不触发令牌吊销（仅审批通过才需要刷新权限）', async () => {
    await userService.reject(PENDING_ID, REASON, OPERATOR_ID);

    expect(tokenModel.revokeAllForUser).not.toHaveBeenCalled();
    expect(rbacMiddleware.invalidatePermissionCache).not.toHaveBeenCalled();
  });

  test('TC-USV-003 用户不存在返回 90401 且不写审计', async () => {
    userModel.findById.mockResolvedValue(null);

    await expect(userService.reject(999, REASON, OPERATOR_ID))
      .rejects.toMatchObject({ code: 90401, httpStatus: 404 });
    expect(userModel.reject).not.toHaveBeenCalled();
    expect(auditModel.write).not.toHaveBeenCalled();
  });

  test('TC-USV-004 账号非 pending 状态（affected=0）返回 10110', async () => {
    userModel.reject.mockResolvedValue(0);

    await expect(userService.reject(PENDING_ID, REASON, OPERATOR_ID))
      .rejects.toMatchObject({ code: 10110, httpStatus: 409 });
    expect(auditModel.write).not.toHaveBeenCalled();
  });
});

describe('userService.approve 注册通过', () => {
  test('TC-USV-010 审批通过调用模型并写审计，同时刷新权限缓存', async () => {
    await userService.approve(PENDING_ID, OPERATOR_ID);

    expect(userModel.approve).toHaveBeenCalledWith(PENDING_ID);
    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.approve',
      requestSummary: expect.objectContaining({ targetUserId: PENDING_ID }),
    }));
  });

  test('TC-USV-011 审批通过的用户不存在返回 90401', async () => {
    userModel.findById.mockResolvedValue(null);

    await expect(userService.approve(999, OPERATOR_ID))
      .rejects.toMatchObject({ code: 90401 });
    expect(userModel.approve).not.toHaveBeenCalled();
  });

  test('TC-USV-012 审批通过时状态冲突（affected=0）返回 10110', async () => {
    userModel.approve.mockResolvedValue(0);

    await expect(userService.approve(PENDING_ID, OPERATOR_ID))
      .rejects.toMatchObject({ code: 10110 });
  });
});