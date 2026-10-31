'use strict';

/**
 * 单元测试：自动判分引擎（纯函数）
 * 需求追溯：REQ-MRK-01（客观题自动判分）、REQ-MRK-02（多选计分策略）、REQ-EXM-08（自动判分）
 * 设计依据：docs/design/系统设计文档.md §3.5.5、§3.6
 */
const {
  gradeQuestion,
  normalizeText,
  normalizeKey,
  toBoolean,
  sameSet,
  isSubset,
} = require('../../backend/src/utils/answering/grader');

describe('判分引擎 gradeQuestion', () => {
  describe('单选题（single）', () => {
    test('TC-GRD-001 正确答案得满分', () => {
      const result = gradeQuestion({
        questionType: 'single',
        correctAnswer: ['B'],
        studentAnswer: ['B'],
        fullScore: 5,
      });
      expect(result).toEqual({ autoScore: 5, isCorrect: true, needsManual: false });
    });

    test('TC-GRD-002 错误答案不得分', () => {
      const result = gradeQuestion({
        questionType: 'single',
        correctAnswer: ['B'],
        studentAnswer: ['C'],
        fullScore: 5,
      });
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });

    test('TC-GRD-003 学生提交多个选项判错（单选只允许 1 项）', () => {
      const result = gradeQuestion({
        questionType: 'single',
        correctAnswer: ['B'],
        studentAnswer: ['B', 'C'],
        fullScore: 5,
      });
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });

    test('TC-GRD-004 未作答（null）不得分且不进入人工阅卷', () => {
      const result = gradeQuestion({
        questionType: 'single',
        correctAnswer: ['B'],
        studentAnswer: null,
        fullScore: 5,
      });
      expect(result.autoScore).toBe(0);
      expect(result.needsManual).toBe(false);
    });

    test('TC-GRD-005 标准答案以字符串传入时自动包装为数组', () => {
      const result = gradeQuestion({
        questionType: 'single',
        correctAnswer: 'B',
        studentAnswer: 'B',
        fullScore: 3,
      });
      expect(result.autoScore).toBe(3);
      expect(result.isCorrect).toBe(true);
    });
  });

  describe('多选题（multiple）', () => {
    const correct = ['A', 'B', 'D'];

    test('TC-GRD-010 全对得满分', () => {
      const result = gradeQuestion({
        questionType: 'multiple', correctAnswer: correct, studentAnswer: ['A', 'B', 'D'], fullScore: 10,
      });
      expect(result.autoScore).toBe(10);
      expect(result.isCorrect).toBe(true);
    });

    test('TC-GRD-011 答案顺序不同仍判为全对', () => {
      const result = gradeQuestion({
        questionType: 'multiple', correctAnswer: correct, studentAnswer: ['D', 'A', 'B'], fullScore: 10,
      });
      expect(result.autoScore).toBe(10);
    });

    test('TC-GRD-012 all_or_nothing 策略下漏选不得分', () => {
      const result = gradeQuestion({
        questionType: 'multiple',
        correctAnswer: correct,
        studentAnswer: ['A', 'B'],
        fullScore: 10,
        strategy: 'all_or_nothing',
      });
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });

    test('TC-GRD-013 half_score 策略下漏选得半分', () => {
      const result = gradeQuestion({
        questionType: 'multiple',
        correctAnswer: correct,
        studentAnswer: ['A', 'B'],
        fullScore: 10,
        strategy: 'half_score',
      });
      expect(result.autoScore).toBe(5);
      expect(result.isCorrect).toBe(false);
      expect(result.note).toBe('少选得半分');
    });

    test('TC-GRD-014 错选（含错误选项）不得分', () => {
      const result = gradeQuestion({
        questionType: 'multiple',
        correctAnswer: correct,
        studentAnswer: ['A', 'C', 'D'],
        fullScore: 10,
        strategy: 'half_score',
      });
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });

    test('TC-GRD-015 多选（超出标准答案）不得分', () => {
      const result = gradeQuestion({
        questionType: 'multiple',
        correctAnswer: correct,
        studentAnswer: ['A', 'B', 'C', 'D'],
        fullScore: 10,
        strategy: 'half_score',
      });
      expect(result.autoScore).toBe(0);
    });

    test('TC-GRD-016 空答案不得分', () => {
      const result = gradeQuestion({
        questionType: 'multiple', correctAnswer: correct, studentAnswer: [], fullScore: 10,
      });
      expect(result.autoScore).toBe(0);
      expect(result.needsManual).toBe(false);
    });

    test('TC-GRD-017 半分按 2 位小数取整（满分 7.5 → 3.75）', () => {
      const result = gradeQuestion({
        questionType: 'multiple',
        correctAnswer: ['A', 'B'],
        studentAnswer: ['A'],
        fullScore: 7.5,
        strategy: 'half_score',
      });
      expect(result.autoScore).toBe(3.75);
    });
  });

  describe('判断题（judge）', () => {
    test('TC-GRD-020 判断正确得满分', () => {
      const result = gradeQuestion({
        questionType: 'judge', correctAnswer: ['true'], studentAnswer: ['true'], fullScore: 5,
      });
      expect(result.autoScore).toBe(5);
      expect(result.isCorrect).toBe(true);
    });

    test('TC-GRD-021 判断错误不得分', () => {
      const result = gradeQuestion({
        questionType: 'judge', correctAnswer: ['false'], studentAnswer: ['true'], fullScore: 5,
      });
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });

    test('TC-GRD-022 兼容中文答案「正确/错误」', () => {
      expect(gradeQuestion({
        questionType: 'judge', correctAnswer: ['true'], studentAnswer: ['正确'], fullScore: 5,
      }).autoScore).toBe(5);
      expect(gradeQuestion({
        questionType: 'judge', correctAnswer: ['false'], studentAnswer: ['错'], fullScore: 5,
      }).autoScore).toBe(5);
    });

    test('TC-GRD-023 非法布尔值判错（不误判为正确）', () => {
      const result = gradeQuestion({
        questionType: 'judge', correctAnswer: ['true'], studentAnswer: ['maybe'], fullScore: 5,
      });
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });
  });

  describe('填空题（fill）', () => {
    test('TC-GRD-030 完全一致得满分', () => {
      const result = gradeQuestion({
        questionType: 'fill', correctAnswer: ['SYN+ACK'], studentAnswer: ['SYN+ACK'], fullScore: 10,
      });
      expect(result.autoScore).toBe(10);
      expect(result.isCorrect).toBe(true);
    });

    test('TC-GRD-031 忽略大小写差异', () => {
      const result = gradeQuestion({
        questionType: 'fill', correctAnswer: ['SYN+ACK'], studentAnswer: ['syn+ack'], fullScore: 10,
      });
      expect(result.autoScore).toBe(10);
    });

    test('TC-GRD-032 忽略全角空格与全角字符', () => {
      const result = gradeQuestion({
        questionType: 'fill', correctAnswer: ['SYN+ACK'], studentAnswer: ['ＳＹＮ＋ＡＣＫ　'], fullScore: 10,
      });
      expect(result.autoScore).toBe(10);
    });

    test('TC-GRD-033 忽略答案中的空白差异', () => {
      const result = gradeQuestion({
        questionType: 'fill', correctAnswer: ['SYN + ACK'], studentAnswer: ['SYN+ACK'], fullScore: 10,
      });
      expect(result.autoScore).toBe(10);
    });

    test('TC-GRD-034 多空按顺序逐项比较，任一空错误即不得分', () => {
      const result = gradeQuestion({
        questionType: 'fill',
        correctAnswer: ['三次握手', 'SYN+ACK'],
        studentAnswer: ['三次握手', 'ACK'],
        fullScore: 10,
      });
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });

    test('TC-GRD-035 多空全对得满分', () => {
      const result = gradeQuestion({
        questionType: 'fill',
        correctAnswer: ['三次握手', 'SYN+ACK'],
        studentAnswer: ['三次握手', 'syn + ack'],
        fullScore: 10,
      });
      expect(result.autoScore).toBe(10);
    });

    test('TC-GRD-036 作答空数与标准答案不一致不得分（不进入人工阅卷）', () => {
      const result = gradeQuestion({
        questionType: 'fill', correctAnswer: ['A', 'B'], studentAnswer: ['A'], fullScore: 10,
      });
      expect(result.autoScore).toBe(0);
      expect(result.needsManual).toBe(false);
    });

    test('TC-GRD-037 标准答案缺失时转人工阅卷', () => {
      const result = gradeQuestion({
        questionType: 'fill', correctAnswer: [], studentAnswer: ['任意'], fullScore: 10,
      });
      expect(result.needsManual).toBe(true);
      expect(result.autoScore).toBe(0);
      expect(result.isCorrect).toBe(false);
    });
  });

  describe('简答题（short）与异常题型', () => {
    test('TC-GRD-040 简答题不自动判分，进入人工阅卷', () => {
      const result = gradeQuestion({
        questionType: 'short', correctAnswer: [], studentAnswer: ['JWT 由三段组成……'], fullScore: 20,
      });
      expect(result).toEqual({ autoScore: 0, isCorrect: null, needsManual: true });
    });

    test('TC-GRD-041 未知题型按人工阅卷处理，不抛异常', () => {
      const result = gradeQuestion({
        questionType: 'essay', correctAnswer: [], studentAnswer: ['x'], fullScore: 20,
      });
      expect(result.needsManual).toBe(true);
      expect(result.autoScore).toBe(0);
    });
  });
});

describe('判分辅助函数', () => {
  test('TC-GRD-050 normalizeText 全角转半角、去首尾空白并折叠连续空白', () => {
    expect(normalizeText('　Ａ　Ｂ　 Ｃ ')).toBe('A B C');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(123)).toBe('123');
  });

  test('TC-GRD-051 normalizeKey 忽略大小写与全部空白', () => {
    expect(normalizeKey(' S Y N + A C K ')).toBe('syn+ack');
    expect(normalizeKey('ＳＹＮ＋ＡＣＫ')).toBe('syn+ack');
  });

  test('TC-GRD-052 toBoolean 支持中英文与数字布尔值', () => {
    expect(toBoolean('TRUE')).toBe(true);
    expect(toBoolean('1')).toBe(true);
    expect(toBoolean('正确')).toBe(true);
    expect(toBoolean('false')).toBe(false);
    expect(toBoolean('0')).toBe(false);
    expect(toBoolean('未知')).toBeNull();
  });

  test('TC-GRD-053 sameSet 对大小写/顺序不敏感', () => {
    expect(sameSet(['a', 'B'], ['B', 'A'])).toBe(true);
    expect(sameSet(['A'], ['A', 'B'])).toBe(false);
  });

  test('TC-GRD-054 isSubset 判定真子集关系', () => {
    expect(isSubset(['a'], ['A', 'b'])).toBe(true);
    expect(isSubset(['a', 'c'], ['A', 'b'])).toBe(false);
  });
});