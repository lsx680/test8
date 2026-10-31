'use strict';

/**
 * 单元测试：判分状态流转与阅卷进度（BUG-2 回归）
 * 需求追溯：REQ-MRK-06（判分可重放）、REQ-STA-05（阅卷进度）、NFR-18（总分=各题得分之和）
 * 缺陷背景：修复前管理员重放 autoGrade 会把 grading_status 由 done 覆写为 auto_done，
 *          而进度看板按 done 统计，导致已完成阅卷的答卷在重放后进度归零。
 * 说明：attempt.model / grading.model / exam.model / question.model / config.service / db 全部 mock。
 */
const attemptModel = require('../../backend/src/models/attempt.model');
const gradingModel = require('../../backend/src/models/grading.model');
const questionModel = require('../../backend/src/models/question.model');
const examModel = require('../../backend/src/models/exam.model');
const configService = require('../../backend/src/services/config.service');
const auditModel = require('../../backend/src/models/audit.model');
const db = require('../../backend/src/config/db');
const gradingService = require('../../backend/src/services/grading.service');

jest.mock('../../backend/src/models/attempt.model');
jest.mock('../../backend/src/models/grading.model');
jest.mock('../../backend/src/models/question.model');
jest.mock('../../backend/src/models/exam.model');
jest.mock('../../backend/src/services/config.service');
jest.mock('../../backend/src/models/audit.model');
jest.mock('../../backend/src/config/db');

const MOCK_CONN = { query: jest.fn() };
const ADMIN = { id: 1, roleCode: 'admin' };
const TEACHER = { id: 2, roleCode: 'teacher' };

function makeAttempt(overrides = {}) {
  return {
    id: 1,
    status: 'graded',
    gradingStatus: 'auto_done',
    passScore: 40,
    ...overrides,
  };
}

function makeObjectiveQuestion(overrides = {}) {
  return {
    id: 11,
    questionType: 'single',
    snapshot: { correctAnswer: ['A'] },
    studentAnswer: ['A'],
    fullScore: 5,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.withTransaction.mockImplementation(async (fn) => fn(MOCK_CONN));
  configService.get.mockResolvedValue('all_or_nothing');
  attemptModel.listAttemptQuestions.mockResolvedValue([makeObjectiveQuestion()]);
  attemptModel.resetObjectiveScores.mockResolvedValue(1);
  attemptModel.updateObjectiveScore.mockResolvedValue(1);
  attemptModel.syncSubjectiveFinal.mockResolvedValue(1);
  attemptModel.updateAttemptTotals.mockResolvedValue(1);
  attemptModel.sumScores.mockResolvedValue({ objective: 30, subjective: 18, total: 48 });
  gradingModel.countTasksByAttempt.mockResolvedValue({ total: 1, pending: 0, arbitration: 0 });
});

describe('autoGrade 状态流转', () => {
  test('TC-GST-001 首次自动判分：无待阅任务时置 auto_done / graded，总分与及格判定正确', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt());

    const result = await gradingService.autoGrade(1);

    expect(result).toMatchObject({
      attemptId: 1,
      objectiveScore: 30,
      subjectiveScore: 18,
      totalScore: 48,
      isPassed: true,
      gradingStatus: 'auto_done',
    });
    expect(attemptModel.updateAttemptTotals).toHaveBeenCalledWith(1, expect.objectContaining({
      objectiveScore: 30,
      subjectiveScore: 18,
      totalScore: 48,
      isPassed: 1,
      gradingStatus: 'auto_done',
      status: 'graded',
    }));
  });

  test('TC-GST-002 已完成的答卷重放判分不回退状态（BUG-2 核心）', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt({ gradingStatus: 'done' }));

    const result = await gradingService.autoGrade(1);

    expect(result.gradingStatus).toBe('done');
    expect(result.gradingStatus).not.toBe('auto_done');
    expect(attemptModel.updateAttemptTotals).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ gradingStatus: 'done' }),
    );
  });

  test('TC-GST-003 连续重放 3 次：状态恒为 done 且总分完全一致（NFR-18 可重放）', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt({ gradingStatus: 'done' }));

    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await gradingService.autoGrade(1));
    }

    expect(results.map((item) => item.gradingStatus)).toEqual(['done', 'done', 'done']);
    expect(results.map((item) => item.totalScore)).toEqual([48, 48, 48]);
    expect(attemptModel.updateAttemptTotals).toHaveBeenCalledTimes(3);
    for (const call of attemptModel.updateAttemptTotals.mock.calls) {
      expect(call[0]).toBe(1);
      expect(call[1].gradingStatus).toBe('done');
    }
  });

  test('TC-GST-004 仍存在待阅任务时置 manual_pending / grading（人工阅卷优先）', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt({ status: 'submitted', gradingStatus: 'manual_pending' }));
    gradingModel.countTasksByAttempt.mockResolvedValue({ total: 2, pending: 1, arbitration: 0 });

    const result = await gradingService.autoGrade(1);

    expect(result.gradingStatus).toBe('manual_pending');
    expect(attemptModel.updateAttemptTotals).toHaveBeenCalledWith(1, expect.objectContaining({
      gradingStatus: 'manual_pending',
      status: 'grading',
    }));
  });

  test('TC-GST-005 已复核（reviewed）的答卷重放后状态保持 reviewed', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt({ status: 'reviewed', gradingStatus: 'done' }));

    await gradingService.autoGrade(1);

    expect(attemptModel.updateAttemptTotals).toHaveBeenCalledWith(1, expect.objectContaining({
      status: 'reviewed',
      gradingStatus: 'done',
    }));
  });

  test('TC-GST-006 客观题按快照重算：错误答案得 0 分并标记不一致', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt());
    attemptModel.listAttemptQuestions.mockResolvedValue([
      makeObjectiveQuestion({ studentAnswer: ['B'] }),
    ]);

    await gradingService.autoGrade(1);

    expect(attemptModel.resetObjectiveScores).toHaveBeenCalledWith(1, MOCK_CONN);
    expect(attemptModel.updateObjectiveScore).toHaveBeenCalledWith(11, {
      autoScore: 0,
      finalScore: 0,
      isCorrect: false,
      gradeStatus: 'auto',
    }, MOCK_CONN);
  });

  test('TC-GST-007 重放不覆盖人工分：主观分取既有 manual_score 汇总值', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt({ gradingStatus: 'done' }));

    const result = await gradingService.autoGrade(1);

    expect(attemptModel.syncSubjectiveFinal).toHaveBeenCalledWith(1, MOCK_CONN);
    expect(result.manualScore).toBe(18);
    expect(result.finalScore).toBe(48);
  });

  test('TC-GST-008 答卷不存在返回 40114', async () => {
    attemptModel.findById.mockResolvedValue(null);

    await expect(gradingService.autoGrade(999)).rejects.toMatchObject({ code: 40114, httpStatus: 404 });
  });

  test('TC-GST-009 答卷无题目快照返回 90409', async () => {
    attemptModel.findById.mockResolvedValue(makeAttempt());
    attemptModel.listAttemptQuestions.mockResolvedValue([]);

    await expect(gradingService.autoGrade(1)).rejects.toMatchObject({ code: 90409 });
  });
});

describe('getGradingProgress 进度看板', () => {
  test('TC-GST-020 完成率按 graded/total 计算，examId 统一为 number（BUG-2 + BUG-3）', async () => {
    examModel.findExamById.mockResolvedValue({ id: 11, ownerId: TEACHER.id });
    gradingModel.examProgress.mockResolvedValue({
      totalAttempts: 3,
      gradedAttempts: 2,
      pendingAttempts: 1,
      totalSubjectiveTasks: 4,
      doneTasks: 2,
      pendingTasks: 2,
      arbitrationTasks: 0,
      graders: [],
    });

    const progress = await gradingService.getGradingProgress('11', ADMIN);

    expect(progress.examId).toBe(11);
    expect(typeof progress.examId).toBe('number');
    expect(progress.gradedAttempts).toBe(2);
    expect(progress.completionRate).toBe(66.67);
    expect(gradingModel.examProgress).toHaveBeenCalledWith('11', ADMIN);
  });

  test('TC-GST-021 无答卷时完成率为 0（避免除零）', async () => {
    examModel.findExamById.mockResolvedValue({ id: 11, ownerId: TEACHER.id });
    gradingModel.examProgress.mockResolvedValue({
      totalAttempts: 0, gradedAttempts: 0, pendingAttempts: 0,
      totalSubjectiveTasks: 0, doneTasks: 0, pendingTasks: 0, arbitrationTasks: 0, graders: [],
    });

    const progress = await gradingService.getGradingProgress(11, ADMIN);

    expect(progress.completionRate).toBe(0);
  });

  test('TC-GST-022 教师访问非本人考试返回 90302', async () => {
    examModel.findExamById.mockResolvedValue({ id: 11, ownerId: 99 });
    gradingModel.examProgress.mockResolvedValue({ totalAttempts: 1, gradedAttempts: 1 });

    await expect(gradingService.getGradingProgress(11, TEACHER))
      .rejects.toMatchObject({ code: 90302, httpStatus: 403 });
  });

  test('TC-GST-023 考试不存在返回 90401', async () => {
    examModel.findExamById.mockResolvedValue(null);

    await expect(gradingService.getGradingProgress(999, ADMIN))
      .rejects.toMatchObject({ code: 90401 });
  });
});