'use strict';

/**
 * 单元测试：字段脱敏与类型转换（REQ-EXM-04 取题脱敏、REQ-SYS-04 审计脱敏）
 * 关键约束：学生视角的题目投影绝不能泄露 correctAnswer / analysis / scoringPoints。
 */
const {
  parseJson,
  toBool,
  toIso,
  toNum,
  projectAttemptQuestion,
  projectPaperQuestion,
  sanitizeForAudit,
} = require('../../backend/src/utils/mask');

const FORBIDDEN_FIELDS = ['correctAnswer', 'analysis', 'scoringPoints', 'correct_answer'];

function serialize(value) {
  return JSON.stringify(value);
}

describe('基础类型转换', () => {
  test('TC-MSK-001 parseJson 处理 null / 对象 / JSON 字符串 / 非法字符串', () => {
    expect(parseJson(null, 'fallback')).toBe('fallback');
    expect(parseJson(undefined, [])).toEqual([]);
    expect(parseJson({ a: 1 })).toEqual({ a: 1 });
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('[1,2]')).toEqual([1, 2]);
    expect(parseJson('not-json', 'fallback')).toBe('fallback');
  });

  test('TC-MSK-002 toBool 将 tinyint(1) 转布尔，null 保持 null', () => {
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool('1')).toBe(true);
    expect(toBool(null)).toBeNull();
    expect(toBool(undefined)).toBeNull();
  });

  test('TC-MSK-003 toIso 将 Date 转 ISO-8601，字符串原样返回', () => {
    const date = new Date('2026-11-10T01:00:00.000Z');
    expect(toIso(date)).toBe('2026-11-10T01:00:00.000Z');
    expect(toIso('2026-11-10T01:00:00.000Z')).toBe('2026-11-10T01:00:00.000Z');
    expect(toIso(null)).toBeNull();
  });

  test('TC-MSK-004 toNum 支持字符串数值并对非法值兜底', () => {
    expect(toNum('12.50')).toBe(12.5);
    expect(toNum(0)).toBe(0);
    expect(toNum(null)).toBe(0);
    expect(toNum(null, 5)).toBe(5);
    expect(toNum('abc', 1)).toBe(1);
  });
});

describe('学生视角题目投影（脱敏）', () => {
  const row = {
    id: 101,
    questionId: 2,
    orderNo: 3,
    questionType: 'multiple',
    fullScore: 10,
    studentAnswer: ['A', 'B'],
    answerSavedAt: '2026-11-10T01:05:00.000Z',
    snapshot: {
      stem: 'HTTP/2 的改进包括？',
      options: [{ key: 'A', content: '多路复用' }],
      correctAnswer: ['A', 'B', 'D'],
      analysis: '本题考查 HTTP/2 协议特性',
      scoringPoints: [{ point: '多路复用', score: 5 }],
    },
  };

  test('TC-MSK-010 投影保留答题所需字段', () => {
    const projected = projectAttemptQuestion(row);
    expect(projected).toEqual({
      attemptQuestionId: 101,
      questionId: 2,
      orderNo: 3,
      questionType: 'multiple',
      stem: 'HTTP/2 的改进包括？',
      options: [{ key: 'A', content: '多路复用' }],
      fullScore: 10,
      studentAnswer: ['A', 'B'],
      answerSavedAt: '2026-11-10T01:05:00.000Z',
    });
  });

  test('TC-MSK-011 投影响应体中不出现 correctAnswer/analysis/scoringPoints 任一字段', () => {
    const projected = projectAttemptQuestion(row);
    expect(Object.keys(projected)).not.toEqual(expect.arrayContaining(FORBIDDEN_FIELDS));
    const text = serialize(projected);
    for (const field of FORBIDDEN_FIELDS) {
      expect(text).not.toContain(field);
    }
    expect(text).not.toContain('本题考查 HTTP/2');
  });

  test('TC-MSK-012 snapshot 缺失时字段兜底为空串/null', () => {
    const projected = projectAttemptQuestion({ id: 1, questionId: 1, orderNo: 1, questionType: 'judge', fullScore: 5 });
    expect(projected.stem).toBe('');
    expect(projected.options).toBeNull();
    expect(projected.studentAnswer).toBeNull();
    expect(projected.answerSavedAt).toBeNull();
  });

  test('TC-MSK-013 试卷预览投影同样不包含答案与解析', () => {
    const projected = projectPaperQuestion({
      paperQuestionId: 9,
      questionId: 1,
      questionNo: 'Q-2026-000001',
      questionType: 'single',
      difficulty: 2,
      stem: 'LRU 缓存',
      options: [{ key: 'A', content: '数组' }],
      knowledgePointId: 2,
      sectionNo: 1,
      orderNo: 1,
      score: 5,
      correctAnswer: ['B'],
      analysis: '哈希表 + 双向链表',
      scoringPoints: null,
    });
    expect(projected).toEqual({
      paperQuestionId: 9,
      questionId: 1,
      questionNo: 'Q-2026-000001',
      questionType: 'single',
      difficulty: 2,
      stem: 'LRU 缓存',
      options: [{ key: 'A', content: '数组' }],
      knowledgePointId: 2,
      sectionNo: 1,
      orderNo: 1,
      score: 5,
    });
    const text = serialize(projected);
    for (const field of FORBIDDEN_FIELDS) expect(text).not.toContain(field);
  });
});

describe('审计请求摘要脱敏', () => {
  test('TC-MSK-020 密码/令牌/答案等敏感字段统一替换为 ***', () => {
    const sanitized = sanitizeForAudit({
      username: 'S2024001',
      password: 'Secret123',
      newPassword: 'NewSecret123',
      accessToken: 'a.b.c',
      refreshToken: 'r.e.f',
      studentAnswer: ['A'],
      correctAnswer: ['B'],
      profile: { phone: '13800000000' },
    });
    expect(sanitized.username).toBe('S2024001');
    expect(sanitized.password).toBe('***');
    expect(sanitized.newPassword).toBe('***');
    expect(sanitized.accessToken).toBe('***');
    expect(sanitized.refreshToken).toBe('***');
    expect(sanitized.studentAnswer).toBe('***');
    expect(sanitized.correctAnswer).toBe('***');
    expect(sanitized.profile.phone).toBe('13800000000');
  });

  test('TC-MSK-021 数组元素递归脱敏', () => {
    const sanitized = sanitizeForAudit([
      { password: 'x' },
      { nested: { token: 1, refreshToken: 'r' } },
    ]);
    expect(sanitized[0].password).toBe('***');
    expect(sanitized[1].nested.refreshToken).toBe('***');
    expect(sanitized[1].nested.token).toBe(1);
  });

  test('TC-MSK-022 超过 500 字符的字符串被截断', () => {
    const long = 'x'.repeat(800);
    const sanitized = sanitizeForAudit({ remark: long });
    expect(sanitized.remark.endsWith('...[truncated]')).toBe(true);
    expect(sanitized.remark.length).toBeLessThan(530);
  });

  test('TC-MSK-023 嵌套超过 4 层给出 [deep] 标记，避免日志膨胀', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'value' } } } } } };
    const sanitized = sanitizeForAudit(deep);
    expect(JSON.stringify(sanitized)).toContain('[deep]');
  });

  test('TC-MSK-024 null / 基本类型原样返回', () => {
    expect(sanitizeForAudit(null)).toBeNull();
    expect(sanitizeForAudit(42)).toBe(42);
    expect(sanitizeForAudit('ok')).toBe('ok');
  });
});