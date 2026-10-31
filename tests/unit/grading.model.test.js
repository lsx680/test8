'use strict';

/**
 * 单元测试：阅卷进度统计口径（BUG-2 回归的数据层部分）
 * 需求追溯：REQ-STA-05（阅卷进度看板）、NFR-18（判分可重放后统计一致）
 * 缺陷背景：修复前进度看板仅统计 grading_status='done'，重放判分写入 auto_done 后统计归零；
 *          修复后口径改为 IN ('done','auto_done')，两种终态都计入已阅份数。
 * 说明：db 模块整体 mock，仅验证 SQL 组装、参数顺序与数值映射，不连接数据库。
 */
const db = require('../../backend/src/config/db');
const gradingModel = require('../../backend/src/models/grading.model');

jest.mock('../../backend/src/config/db');

const ADMIN = { id: 1, roleCode: 'admin' };
const TEACHER = { id: 5, roleCode: 'teacher' };

beforeEach(() => {
  jest.clearAllMocks();
  db.queryOne.mockImplementation(async (sql) => {
    if (sql.includes('ex_exam_attempt')) return { total: 3, graded: 2, pending: 1 };
    return { total: 4, done: 2, pending: 2, arbitration: 0 };
  });
  db.query.mockResolvedValue([
    { grader_id: 2, grader_name: '王立群', assigned_count: '4', graded_count: '2', pending_count: '2' },
  ]);
});

describe('examProgress 统计口径', () => {
  test('TC-GMK-001 已阅份数同时统计 done 与 auto_done（BUG-2 回归守护）', async () => {
    const progress = await gradingModel.examProgress(11, ADMIN);

    const attemptsSql = db.queryOne.mock.calls[0][0];
    expect(attemptsSql).toContain("a.grading_status IN ('done','auto_done')");
    expect(attemptsSql).toContain("a.grading_status NOT IN ('done','auto_done')");
    expect(progress.gradedAttempts).toBe(2);
    expect(progress.totalAttempts).toBe(3);
    expect(progress.pendingAttempts).toBe(1);
  });

  test('TC-GMK-002 待阅任务口径排除 done 与 arbitration', async () => {
    const progress = await gradingModel.examProgress(11, ADMIN);

    const tasksSql = db.queryOne.mock.calls[1][0];
    expect(tasksSql).toContain("t.status <> 'done'");
    expect(tasksSql).toContain("t.status <> 'arbitration'");
    expect(progress.doneTasks).toBe(2);
    expect(progress.pendingTasks).toBe(2);
    expect(progress.arbitrationTasks).toBe(0);
  });

  test('TC-GMK-003 管理员查询不附加归属过滤，参数仅含 examId', async () => {
    await gradingModel.examProgress(11, ADMIN);

    const [, params] = db.queryOne.mock.calls[0];
    expect(params).toEqual([11]);
    expect(db.queryOne.mock.calls[0][0]).not.toContain('e.owner_id = ?');
  });

  test('TC-GMK-004 教师查询附加 owner 过滤且参数顺序为 [examId, ownerId]', async () => {
    await gradingModel.examProgress(11, TEACHER);

    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql).toContain('e.owner_id = ?');
    expect(params).toEqual([11, 5]);
    expect(db.query.mock.calls[0][1]).toEqual([11, 5]);
  });

  test('TC-GMK-005 阅卷人聚合数值统一转换为 number', async () => {
    const progress = await gradingModel.examProgress(11, ADMIN);

    expect(progress.graders).toEqual([{
      graderId: 2,
      graderName: '王立群',
      assignedCount: 4,
      gradedCount: 2,
      pendingCount: 2,
    }]);
    for (const key of ['graderId', 'assignedCount', 'gradedCount', 'pendingCount']) {
      expect(typeof progress.graders[0][key]).toBe('number');
    }
  });

  test('TC-GMK-006 空统计（SUM 为 NULL）时各计数兜底为 0', async () => {
    db.queryOne.mockImplementation(async (sql) => (sql.includes('ex_exam_attempt')
      ? { total: 0, graded: null, pending: null }
      : { total: 0, done: null, pending: null, arbitration: null }));
    db.query.mockResolvedValue([]);

    const progress = await gradingModel.examProgress(11, ADMIN);

    expect(progress).toMatchObject({
      totalAttempts: 0,
      gradedAttempts: 0,
      pendingAttempts: 0,
      doneTasks: 0,
      pendingTasks: 0,
      arbitrationTasks: 0,
      graders: [],
    });
  });
});

describe('countTasksByAttempt 任务统计', () => {
  test('TC-GMK-010 pending 口径为 status <> done，并透传事务连接', async () => {
    const conn = { query: jest.fn().mockResolvedValue([[{ total: '3', pending: '2', arbitration: '1' }]]) };

    const result = await gradingModel.countTasksByAttempt(1, conn);

    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain("SUM(status <> 'done') AS pending");
    expect(result).toEqual({ total: 3, pending: 2, arbitration: 1 });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('TC-GMK-011 无阅卷任务时返回全 0', async () => {
    db.query.mockResolvedValue([{ total: 0, pending: null, arbitration: null }]);

    const result = await gradingModel.countTasksByAttempt(1);

    expect(result).toEqual({ total: 0, pending: 0, arbitration: 0 });
  });
});