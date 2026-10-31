'use strict';

/**
 * 单元测试：请求体校验（REQ-QBM-01/02 题型与答案约束、REQ-PPM-03 组卷分值）
 * 覆盖题型策略校验器与 zod schema 的边界值。
 */
const { validateQuestionPayload } = require('../../backend/src/validators/question.validator');
const schemas = require('../../backend/src/validators/schemas');

const OPTIONS = [
  { key: 'A', content: '顺序数组' },
  { key: 'B', content: '哈希表 + 双向链表' },
  { key: 'C', content: '栈' },
  { key: 'D', content: '单向队列' },
];

describe('题型策略校验器 validateQuestionPayload', () => {
  test('TC-VAL-001 合法单选题通过校验', () => {
    expect(validateQuestionPayload({
      questionType: 'single', options: OPTIONS, correctAnswer: ['B'], defaultScore: 5,
    })).toBe(true);
  });

  test('TC-VAL-002 非法题型抛 20101（400）', () => {
    expect(() => validateQuestionPayload({ questionType: 'essay', correctAnswer: [] }))
      .toThrow(expect.objectContaining({ code: 20101, httpStatus: 400 }));
  });

  test('TC-VAL-003 单选题答案数量必须为 1', () => {
    expect(() => validateQuestionPayload({
      questionType: 'single', options: OPTIONS, correctAnswer: ['A', 'B'], defaultScore: 5,
    })).toThrow(expect.objectContaining({ code: 20102, httpStatus: 422 }));
  });

  test('TC-VAL-004 单选题答案必须存在于选项中', () => {
    expect(() => validateQuestionPayload({
      questionType: 'single', options: OPTIONS, correctAnswer: ['Z'], defaultScore: 5,
    })).toThrow(expect.objectContaining({ code: 20102 }));
  });

  test('TC-VAL-005 选项少于 2 项、key 重复、内容为空均抛 20103', () => {
    expect(() => validateQuestionPayload({
      questionType: 'single', options: [{ key: 'A', content: 'x' }], correctAnswer: ['A'], defaultScore: 5,
    })).toThrow(expect.objectContaining({ code: 20103 }));

    expect(() => validateQuestionPayload({
      questionType: 'single',
      options: [{ key: 'A', content: 'x' }, { key: 'A', content: 'y' }],
      correctAnswer: ['A'],
      defaultScore: 5,
    })).toThrow(expect.objectContaining({ code: 20103 }));

    expect(() => validateQuestionPayload({
      questionType: 'single',
      options: [{ key: 'A', content: 'x' }, { key: 'B', content: '   ' }],
      correctAnswer: ['A'],
      defaultScore: 5,
    })).toThrow(expect.objectContaining({ code: 20103 }));
  });

  test('TC-VAL-006 多选题答案至少 2 项且不可重复', () => {
    expect(validateQuestionPayload({
      questionType: 'multiple', options: OPTIONS, correctAnswer: ['A', 'B', 'D'], defaultScore: 10,
    })).toBe(true);

    expect(() => validateQuestionPayload({
      questionType: 'multiple', options: OPTIONS, correctAnswer: ['A'], defaultScore: 10,
    })).toThrow(expect.objectContaining({ code: 20102 }));

    expect(() => validateQuestionPayload({
      questionType: 'multiple', options: OPTIONS, correctAnswer: ['A', 'A'], defaultScore: 10,
    })).toThrow(expect.objectContaining({ code: 20102 }));
  });

  test('TC-VAL-007 判断题不得有选项且答案必须为 true/false', () => {
    expect(validateQuestionPayload({
      questionType: 'judge', options: null, correctAnswer: ['true'], defaultScore: 5,
    })).toBe(true);
    expect(validateQuestionPayload({
      questionType: 'judge', correctAnswer: ['FALSE'], defaultScore: 5,
    })).toBe(true);

    expect(() => validateQuestionPayload({
      questionType: 'judge', options: OPTIONS, correctAnswer: ['true'], defaultScore: 5,
    })).toThrow(expect.objectContaining({ code: 20103 }));

    expect(() => validateQuestionPayload({
      questionType: 'judge', correctAnswer: ['不确定'], defaultScore: 5,
    })).toThrow(expect.objectContaining({ code: 20102 }));
  });

  test('TC-VAL-008 填空题答案非空且每项不得为空白', () => {
    expect(validateQuestionPayload({
      questionType: 'fill', correctAnswer: ['SYN+ACK'], defaultScore: 10,
    })).toBe(true);

    expect(() => validateQuestionPayload({
      questionType: 'fill', correctAnswer: [], defaultScore: 10,
    })).toThrow(expect.objectContaining({ code: 20102 }));

    expect(() => validateQuestionPayload({
      questionType: 'fill', correctAnswer: [' '], defaultScore: 10,
    })).toThrow(expect.objectContaining({ code: 20102 }));
  });

  test('TC-VAL-009 简答题必须提供采分点，且采分点分值之和不得超过满分（20109）', () => {
    expect(validateQuestionPayload({
      questionType: 'short',
      correctAnswer: [],
      scoringPoints: [{ point: '指出三段结构', score: 6 }, { point: '说明签名作用', score: 4 }],
      defaultScore: 10,
    })).toBe(true);

    expect(() => validateQuestionPayload({
      questionType: 'short', correctAnswer: [], scoringPoints: [], defaultScore: 10,
    })).toThrow(expect.objectContaining({ code: 20102 }));

    expect(() => validateQuestionPayload({
      questionType: 'short',
      correctAnswer: [],
      scoringPoints: [{ point: 'A', score: 8 }, { point: 'B', score: 5 }],
      defaultScore: 10,
    })).toThrow(expect.objectContaining({ code: 20109, httpStatus: 422 }));
  });

  test('TC-VAL-010 简答题未提供 correctAnswer 时自动补为空数组', () => {
    const payload = {
      questionType: 'short',
      scoringPoints: [{ point: 'A', score: 2 }],
      defaultScore: 5,
    };
    validateQuestionPayload(payload);
    expect(payload.correctAnswer).toEqual([]);
  });
});

describe('zod 请求 Schema 边界', () => {
  test('TC-VAL-020 注册用户名 \${4~32} 位且密码强度校验', () => {
    const valid = schemas.register.parse({
      username: 'S2024001', realName: '李思远', password: 'Student@2026', classId: 1, email: 's@oes.test',
    });
    expect(valid.username).toBe('S2024001');

    expect(() => schemas.register.parse({
      username: 'abc', realName: 'x', password: 'Student@2026', classId: 1, email: 's@oes.test',
    })).toThrow();

    expect(() => schemas.register.parse({
      username: 'S2024001', realName: 'x', password: 'weakpwd', classId: 1, email: 's@oes.test',
    })).toThrow();
  });

  test('TC-VAL-021 试卷至少 1 道题，时长 1~180 分钟', () => {
    expect(() => schemas.paperCreate.parse({
      paperName: '空卷', totalScore: 10, durationMinutes: 30, questions: [],
    })).toThrow();

    expect(() => schemas.paperCreate.parse({
      paperName: '超时卷', totalScore: 10, durationMinutes: 181, questions: [{ questionId: 1, score: 10 }],
    })).toThrow();
  });

  test('TC-VAL-022 答案暂存必须至少提交 1 条', () => {
    expect(() => schemas.saveAnswers.parse({ answers: [] })).toThrow();
    expect(schemas.saveAnswers.parse({ answers: [{ questionId: 1, answer: ['A'] }] }).answers).toHaveLength(1);
  });

  test('TC-VAL-023 人工评分分值不能为负数，仲裁必须填写理由', () => {
    expect(() => schemas.scoreSubmit.parse({ score: -1 })).toThrow();
    expect(() => schemas.arbitrate.parse({ score: 10 })).toThrow();
    expect(schemas.arbitrate.parse({ score: 10, reason: '双评分差超过阈值' }).score).toBe(10);
  });

  test('TC-VAL-024 防作弊事件类型限定为 5 类', () => {
    for (const type of ['switch_screen', 'exit_fullscreen', 'copy_paste', 'multi_device', 'blur']) {
      expect(schemas.antiCheatEvent.parse({ eventType: type }).eventType).toBe(type);
    }
    expect(() => schemas.antiCheatEvent.parse({ eventType: 'unknown' })).toThrow();
  });
});