'use strict';

/**
 * 判分引擎单元验证（可直接 node 运行）
 * 覆盖：单选、多选全对/漏选/错选、判断、填空大小写与全角、简答人工分
 */
const assert = require('assert');
const { gradeQuestion, normalizeText, toBoolean } = require('../src/utils/answering/grader');

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

test('单选：答案正确得满分', () => {
  const result = gradeQuestion({ questionType: 'single', correctAnswer: ['B'], studentAnswer: ['B'], fullScore: 5 });
  assert.strictEqual(result.autoScore, 5);
  assert.strictEqual(result.isCorrect, true);
});

test('单选：答案错误得 0 分', () => {
  const result = gradeQuestion({ questionType: 'single', correctAnswer: ['B'], studentAnswer: ['A'], fullScore: 5 });
  assert.strictEqual(result.autoScore, 0);
  assert.strictEqual(result.isCorrect, false);
});

test('单选：多选答案不得分', () => {
  const result = gradeQuestion({ questionType: 'single', correctAnswer: ['B'], studentAnswer: ['B', 'C'], fullScore: 5 });
  assert.strictEqual(result.autoScore, 0);
});

test('多选：全对得满分（顺序无关）', () => {
  const result = gradeQuestion({ questionType: 'multiple', correctAnswer: ['A', 'B', 'D'], studentAnswer: ['D', 'B', 'A'], fullScore: 10 });
  assert.strictEqual(result.autoScore, 10);
  assert.strictEqual(result.isCorrect, true);
});

test('多选：all_or_nothing 漏选得 0 分', () => {
  const result = gradeQuestion({ questionType: 'multiple', correctAnswer: ['A', 'B', 'D'], studentAnswer: ['A', 'B'], fullScore: 10, strategy: 'all_or_nothing' });
  assert.strictEqual(result.autoScore, 0);
  assert.strictEqual(result.isCorrect, false);
  assert.strictEqual(result.note, '多选或错选');
});

test('多选：half_score 漏选得半分', () => {
  const result = gradeQuestion({ questionType: 'multiple', correctAnswer: ['A', 'B', 'D'], studentAnswer: ['A', 'B'], fullScore: 10, strategy: 'half_score' });
  assert.strictEqual(result.autoScore, 5);
  assert.strictEqual(result.isCorrect, false);
});

test('多选：half_score 错选得 0 分', () => {
  const result = gradeQuestion({ questionType: 'multiple', correctAnswer: ['A', 'B'], studentAnswer: ['A', 'C'], fullScore: 10, strategy: 'half_score' });
  assert.strictEqual(result.autoScore, 0);
});

test('多选：空答案得 0 分', () => {
  const result = gradeQuestion({ questionType: 'multiple', correctAnswer: ['A', 'B'], studentAnswer: [], fullScore: 10 });
  assert.strictEqual(result.autoScore, 0);
});

test('判断：true 与文本 true 等价', () => {
  const result = gradeQuestion({ questionType: 'judge', correctAnswer: ['true'], studentAnswer: ['true'], fullScore: 5 });
  assert.strictEqual(result.autoScore, 5);
  assert.strictEqual(result.isCorrect, true);
});

test('判断：false 与 true 不得分', () => {
  const result = gradeQuestion({ questionType: 'judge', correctAnswer: ['true'], studentAnswer: ['false'], fullScore: 5 });
  assert.strictEqual(result.autoScore, 0);
});

test('填空：忽略大小写、首尾空格与全角字符', () => {
  const result = gradeQuestion({ questionType: 'fill', correctAnswer: ['SYN+ACK'], studentAnswer: ['  syn+ack  '], fullScore: 10 });
  assert.strictEqual(result.autoScore, 10);
  assert.strictEqual(result.isCorrect, true);
});

test('填空：中文全角与半角等价', () => {
  const result = gradeQuestion({ questionType: 'fill', correctAnswer: ['三次握手'], studentAnswer: ['三次握手'], fullScore: 10 });
  assert.strictEqual(result.autoScore, 10);
  assert.strictEqual(normalizeText('ＡＢＣ'), 'ABC');
});

test('填空：多空逐项比对，任一错误不得分', () => {
  const result = gradeQuestion({ questionType: 'fill', correctAnswer: ['TCP', 'UDP'], studentAnswer: ['tcp', 'http'], fullScore: 10 });
  assert.strictEqual(result.autoScore, 0);
  assert.strictEqual(result.isCorrect, false);
});

test('填空：空数量不一致不得分', () => {
  const result = gradeQuestion({ questionType: 'fill', correctAnswer: ['TCP', 'UDP'], studentAnswer: ['TCP'], fullScore: 10 });
  assert.strictEqual(result.autoScore, 0);
});

test('简答：不自动判分，进入人工复核', () => {
  const result = gradeQuestion({ questionType: 'short', correctAnswer: [], studentAnswer: ['JWT 由三段组成'], fullScore: 20 });
  assert.strictEqual(result.autoScore, 0);
  assert.strictEqual(result.isCorrect, null);
  assert.strictEqual(result.needsManual, true);
});

test('未知题型：保守进入人工复核', () => {
  const result = gradeQuestion({ questionType: 'unknown', correctAnswer: [], studentAnswer: ['x'], fullScore: 10 });
  assert.strictEqual(result.autoScore, 0);
  assert.strictEqual(result.needsManual, true);
});

test('布尔归一化：正确/对/1 视为 true', () => {
  assert.strictEqual(toBoolean('正确'), true);
  assert.strictEqual(toBoolean('1'), true);
  assert.strictEqual(toBoolean('错误'), false);
  assert.strictEqual(toBoolean('unknown'), null);
});

let passed = 0;
let failed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS  ${item.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${item.name}: ${err.message}`);
  }
}
console.log(`\n判分引擎验证：${passed}/${cases.length} 通过，${failed} 失败`);
if (failed > 0) process.exitCode = 1;