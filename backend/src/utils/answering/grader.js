'use strict';

/**
 * 自动判分引擎（纯函数，便于单元测试与重放）
 * 依据：设计文档 §3.5.5、§3.6、schema.sql 中 correct_answer 的 JSON 数组结构
 *
 * 约定：
 *   single   ["B"]                 集合相等
 *   multiple ["A","B","D"]         全对得分；half_score 策略下少选（非空真子集）得半分
 *   judge    ["true"] / ["false"]  布尔相等
 *   fill     ["SYN+ACK","三次"]    按空顺序逐项比较（去空格、全半角归一、忽略大小写）
 *   short    []                    不自动判分，进入人工阅卷队列
 */

const { OBJECTIVE_TYPES } = require('../../config/constants');

/** 全角转半角 + 去首尾空白 + 连续空白折叠 */
function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** 文本归一化键：忽略大小写与全部空白（填空题常见大小写/空格差异） */
function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function toBoolean(value) {
  const key = normalizeText(value).toLowerCase();
  if (['true', '1', 't', 'yes', 'y', '正确', '对'].includes(key)) return true;
  if (['false', '0', 'f', 'no', 'n', '错误', '错'].includes(key)) return false;
  return null;
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const a = [...new Set(left.map(normalizeKey))].sort();
  const b = [...new Set(right.map(normalizeKey))].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function isSubset(subset, superset) {
  const superKeys = new Set(superset.map(normalizeKey));
  return subset.every((item) => superKeys.has(normalizeKey(item)));
}

const graders = {
  single(correctAnswer, studentAnswer) {
    const correct = asArray(correctAnswer);
    const answer = asArray(studentAnswer);
    const correctFlag = answer.length === 1 && sameSet(correct, answer);
    return { isCorrect: correctFlag, ratio: correctFlag ? 1 : 0, needsManual: false };
  },

  multiple(correctAnswer, studentAnswer, { strategy = 'all_or_nothing', fullScore = 0 } = {}) {
    const correct = asArray(correctAnswer);
    const answer = asArray(studentAnswer);
    if (answer.length === 0) return { isCorrect: false, ratio: 0, needsManual: false };
    const exact = sameSet(correct, answer);
    if (exact) return { isCorrect: true, ratio: 1, needsManual: false };
    // 少选：答案是非空真子集，且配置为 half_score 时得半分
    if (strategy === 'half_score' && isSubset(answer, correct) && answer.length < correct.length) {
      return { isCorrect: false, ratio: 0.5, needsManual: false, note: '少选得半分' };
    }
    // 多选/错选：不得分
    return { isCorrect: false, ratio: 0, needsManual: false, note: fullScore > 0 ? '多选或错选' : undefined };
  },

  judge(correctAnswer, studentAnswer) {
    const correct = toBoolean(asArray(correctAnswer)[0]);
    const answer = toBoolean(asArray(studentAnswer)[0]);
    const correctFlag = correct !== null && answer !== null && correct === answer;
    return { isCorrect: correctFlag, ratio: correctFlag ? 1 : 0, needsManual: false };
  },

  fill(correctAnswer, studentAnswer) {
    const correct = asArray(correctAnswer);
    const answer = asArray(studentAnswer);
    if (correct.length === 0) return { isCorrect: false, ratio: 0, needsManual: true };
    if (answer.length !== correct.length) return { isCorrect: false, ratio: 0, needsManual: false };
    const correctFlag = correct.every((item, index) => normalizeKey(item) === normalizeKey(answer[index]));
    return { isCorrect: correctFlag, ratio: correctFlag ? 1 : 0, needsManual: false };
  },

  short() {
    return { isCorrect: null, ratio: 0, needsManual: true };
  },
};

/**
 * 单题判分
 * @param {object} input { questionType, correctAnswer, studentAnswer, fullScore, strategy }
 * @returns {{autoScore:number,isCorrect:boolean|null,needsManual:boolean,note?:string}}
 */
function gradeQuestion({ questionType, correctAnswer, studentAnswer, fullScore = 0, strategy = 'all_or_nothing' }) {
  if (!OBJECTIVE_TYPES.includes(questionType) && questionType !== 'short') {
    return { autoScore: 0, isCorrect: null, needsManual: true };
  }
  if (questionType === 'short') return { autoScore: 0, isCorrect: null, needsManual: true };

  const grader = graders[questionType];
  if (!grader) return { autoScore: 0, isCorrect: null, needsManual: true };

  const result = grader(correctAnswer, studentAnswer, { strategy, fullScore });
  const score = Number((Number(fullScore) * result.ratio).toFixed(2));
  const payload = {
    autoScore: score,
    isCorrect: result.isCorrect,
    needsManual: result.needsManual,
  };
  if (result.note) payload.note = result.note;
  return payload;
}

module.exports = { gradeQuestion, normalizeText, normalizeKey, toBoolean, sameSet, isSubset };