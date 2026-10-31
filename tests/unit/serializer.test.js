'use strict';

/**
 * 单元测试：响应数值字段序列化（BUG-3 回归）
 * 需求追溯：契约 publishScores / ExamMonitor / GradingProgress 的 examId 为 integer；
 *          REQ-STA-02（成绩发布）、REQ-STA-05（阅卷进度）、REQ-EXM-09（考试监控）
 * 缺陷背景：修复前服务层直接回传 req.params.examId（字符串 "4"），与契约 type: integer 不符；
 *          修复后统一 Number(examId)，并复用 utils/mask.toNum 做数值兜底。
 * 说明：全部数据访问层 mock，不连接数据库。
 */
const examModel = require('../../backend/src/models/exam.model');
const gradingModel = require('../../backend/src/models/grading.model');
const statModel = require('../../backend/src/models/stat.model');
const systemModel = require('../../backend/src/models/system.model');
const attemptModel = require('../../backend/src/models/attempt.model');
const auditModel = require('../../backend/src/models/audit.model');
const configService = require('../../backend/src/services/config.service');
const db = require('../../backend/src/config/db');
const examService = require('../../backend/src/services/exam.service');
const gradingService = require('../../backend/src/services/grading.service');
const gradeService = require('../../backend/src/services/grade.service');
const { toNum, projectAttemptQuestion } = require('../../backend/src/utils/mask');

jest.mock('../../backend/src/models/exam.model');
jest.mock('../../backend/src/models/grading.model');
jest.mock('../../backend/src/models/stat.model');
jest.mock('../../backend/src/models/system.model');
jest.mock('../../backend/src/models/attempt.model');
jest.mock('../../backend/src/models/audit.model');
jest.mock('../../backend/src/services/config.service');
jest.mock('../../backend/src/config/db');

const MOCK_CONN = { query: jest.fn() };
const ADMIN = { id: 1, roleCode: 'admin' };
const OWNER_ID = 2;

beforeEach(() => {
  jest.clearAllMocks();
  db.withTransaction.mockImplementation(async (fn) => fn(MOCK_CONN));
  auditModel.write.mockResolvedValue(true);
  configService.getNumber.mockResolvedValue(7);
});

describe('utils/mask.toNum 数值规范化', () => {
  test('TC-SER-001 字符串 "4" 转为 number 4（BUG-3 的最小复现单元）', () => {
    const value = toNum('4');

    expect(value).toBe(4);
    expect(typeof value).toBe('number');
    expect(Number.isInteger(value)).toBe(true);
  });

  test('TC-SER-002 小数、零值、布尔与数字输入均保持数值语义', () => {
    expect(toNum('4.5')).toBe(4.5);
    expect(toNum('0')).toBe(0);
    expect(toNum(0)).toBe(0);
    expect(toNum(true)).toBe(1);
    expect(toNum(12)).toBe(12);
  });

  test('TC-SER-003 null / undefined / 非法字符串回退 fallback（默认 0）', () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum('abc')).toBe(0);
    expect(toNum(null, -1)).toBe(-1);
    expect(toNum('abc', 'N/A')).toBe('N/A');
  });
});

describe('服务层 examId 类型（契约 integer）', () => {
  test('TC-SER-010 考试监控 examId 由 "11" 归一为 11，并计算在线率', async () => {
    examModel.findExamById.mockResolvedValue({ id: 11, examName: '操作系统期中', ownerId: OWNER_ID });
    examModel.monitorCounts.mockResolvedValue({
      totalStudents: 4, doingCount: 1, submittedCount: 2, missedCount: 1, abnormalCount: 0,
    });
    examModel.listAbnormalAttempts.mockResolvedValue([]);

    const monitor = await examService.getExamMonitor('11', ADMIN);

    expect(monitor.examId).toBe(11);
    expect(typeof monitor.examId).toBe('number');
    expect(monitor.onlineRate).toBe(75);
    expect(monitor.examName).toBe('操作系统期中');
  });

  test('TC-SER-011 考试发布（重放分支）examId 为 number 且任务数透传', async () => {
    examModel.findExamById.mockResolvedValue({
      id: 11, examName: '操作系统期中', ownerId: OWNER_ID, status: 'published', createdAt: '2026-10-31T00:00:00.000Z',
    });
    examModel.taskStats.mockResolvedValue({ total: 3 });

    const published = await examService.publishExam('11', ADMIN);

    expect(published.examId).toBe(11);
    expect(typeof published.examId).toBe('number');
    expect(published).toMatchObject({ status: 'published', replayed: true, taskCount: 3 });
  });

  test('TC-SER-012 阅卷进度 examId 为 number', async () => {
    examModel.findExamById.mockResolvedValue({ id: 11, ownerId: OWNER_ID });
    gradingModel.examProgress.mockResolvedValue({
      totalAttempts: 2, gradedAttempts: 1, pendingAttempts: 1,
      totalSubjectiveTasks: 1, doneTasks: 1, pendingTasks: 0, arbitrationTasks: 0, graders: [],
    });

    const progress = await gradingService.getGradingProgress('11', ADMIN);

    expect(progress.examId).toBe(11);
    expect(typeof progress.examId).toBe('number');
    expect(progress.completionRate).toBe(50);
  });

  test('TC-SER-013 成绩发布 examId 为 number 且通知人数正确', async () => {
    examModel.findExamById.mockResolvedValue({
      id: 11, examName: '操作系统期中', ownerId: OWNER_ID, scoreStatus: 'unpublished',
    });
    gradingModel.countPendingByExam.mockResolvedValue(0);
    examModel.setScorePublished.mockResolvedValue(1);
    gradingModel.setAppealDeadlinesForExam.mockResolvedValue(1);
    examModel.listTaskStudentIds.mockResolvedValue([101, 102]);
    systemModel.createNotifications.mockResolvedValue(2);

    const result = await gradeService.publishScores('11', ADMIN);

    expect(result.examId).toBe(11);
    expect(typeof result.examId).toBe('number');
    expect(result).toMatchObject({ scoreStatus: 'published', notifiedCount: 2 });
    // 内部 SQL 参数沿用原始字符串（MySQL 隐式转换为整数），响应字段 examId 已归一为 number
    expect(gradingModel.setAppealDeadlinesForExam).toHaveBeenCalledWith('11', expect.any(Date));
  });

  test('TC-SER-014 四处响应 examId 均为整数字面量（跨服务一致性守护）', async () => {
    examModel.findExamById.mockResolvedValue({
      id: 11, examName: '操作系统期中', ownerId: OWNER_ID, status: 'published',
      scoreStatus: 'unpublished', createdAt: '2026-10-31T00:00:00.000Z',
    });
    examModel.monitorCounts.mockResolvedValue({
      totalStudents: 1, doingCount: 0, submittedCount: 1, missedCount: 0, abnormalCount: 0,
    });
    examModel.listAbnormalAttempts.mockResolvedValue([]);
    examModel.taskStats.mockResolvedValue({ total: 1 });
    examModel.setScorePublished.mockResolvedValue(1);
    examModel.listTaskStudentIds.mockResolvedValue([101]);
    gradingModel.examProgress.mockResolvedValue({
      totalAttempts: 1, gradedAttempts: 1, pendingAttempts: 0,
      totalSubjectiveTasks: 1, doneTasks: 1, pendingTasks: 0, arbitrationTasks: 0, graders: [],
    });
    gradingModel.countPendingByExam.mockResolvedValue(0);
    gradingModel.setAppealDeadlinesForExam.mockResolvedValue(1);
    systemModel.createNotifications.mockResolvedValue(1);

    const [monitor, published, progress, scores] = await Promise.all([
      examService.getExamMonitor('11', ADMIN),
      examService.publishExam('11', ADMIN),
      gradingService.getGradingProgress('11', ADMIN),
      gradeService.publishScores('11', ADMIN),
    ]);

    for (const value of [monitor.examId, published.examId, progress.examId, scores.examId]) {
      expect(value).toBe(11);
      expect(typeof value).toBe('number');
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('答卷题目投影数值字段', () => {
  test('TC-SER-020 投影保留数值型 fullScore / orderNo 且不改变类型', () => {
    const projected = projectAttemptQuestion({
      id: 12,
      questionId: 33,
      orderNo: 1,
      questionType: 'single',
      snapshot: { stem: '题干', options: [{ key: 'A', content: '甲' }] },
      fullScore: 5,
      studentAnswer: ['A'],
      answerSavedAt: '2026-10-31T00:00:00.000Z',
    });

    expect(projected.attemptQuestionId).toBe(12);
    expect(typeof projected.fullScore).toBe('number');
    expect(projected.fullScore).toBe(5);
    expect(typeof projected.orderNo).toBe('number');
    expect(projected).not.toHaveProperty('snapshot');
  });
});