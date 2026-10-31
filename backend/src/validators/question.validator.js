'use strict';

const { QUESTION_TYPES } = require('../config/constants');
const { fail } = require('../utils/errors');

/**
 * 题型校验器（策略模式，设计文档 §3.3.4）
 * 新增题型时在此注册即可，不影响判分主流程（NFR-16）
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateOptions(options) {
  if (!Array.isArray(options) || options.length < 2) throw fail(20103, { message: '选项至少需要 2 项' });
  const keys = options.map((opt) => (opt && typeof opt.key === 'string' ? opt.key.trim() : ''));
  if (keys.some((key) => key === '')) throw fail(20103, { message: '选项 key 不能为空' });
  if (new Set(keys).size !== keys.length) throw fail(20103, { message: '选项 key 不能重复' });
  if (options.some((opt) => !isNonEmptyString(opt.content))) throw fail(20103, { message: '选项内容不能为空' });
  return keys;
}

const validators = {
  single(payload) {
    const keys = validateOptions(payload.options);
    const answer = payload.correctAnswer;
    if (!Array.isArray(answer) || answer.length !== 1) throw fail(20102, { message: '单选题答案必须且只能有 1 项' });
    if (!keys.includes(answer[0])) throw fail(20102, { message: '单选题答案不在选项中' });
  },
  multiple(payload) {
    const keys = validateOptions(payload.options);
    const answer = payload.correctAnswer;
    if (!Array.isArray(answer) || answer.length < 2) throw fail(20102, { message: '多选题答案至少 2 项' });
    if (new Set(answer).size !== answer.length) throw fail(20102, { message: '多选题答案不能重复' });
    if (answer.some((item) => !keys.includes(item))) throw fail(20102, { message: '多选题答案不在选项中' });
  },
  judge(payload) {
    if (Array.isArray(payload.options) && payload.options.length > 0) {
      throw fail(20103, { message: '判断题不应包含选项' });
    }
    const answer = payload.correctAnswer;
    if (!Array.isArray(answer) || answer.length !== 1 || !['true', 'false'].includes(String(answer[0]).toLowerCase())) {
      throw fail(20102, { message: '判断题答案必须为 true 或 false' });
    }
  },
  fill(payload) {
    const answer = payload.correctAnswer;
    if (!Array.isArray(answer) || answer.length === 0) throw fail(20102, { message: '填空题答案不能为空' });
    if (answer.some((item) => !isNonEmptyString(item))) throw fail(20102, { message: '填空答案每项都不能为空' });
  },
  short(payload) {
    const points = payload.scoringPoints;
    if (!Array.isArray(points) || points.length === 0) throw fail(20102, { message: '简答题必须提供采分点' });
    if (points.some((point) => !isNonEmptyString(point.point) || !(Number(point.score) > 0))) {
      throw fail(20102, { message: '采分点名称与分值必须合法' });
    }
    const sum = points.reduce((acc, point) => acc + Number(point.score), 0);
    if (sum > Number(payload.defaultScore)) throw fail(20109, { data: { scoringPointSum: sum, defaultScore: payload.defaultScore } });
    if (!Array.isArray(payload.correctAnswer)) payload.correctAnswer = [];
  },
};

/** 校验题目载荷；题型非法直接 400（20101） */
function validateQuestionPayload(payload) {
  if (!payload || !QUESTION_TYPES.includes(payload.questionType)) throw fail(20101);
  validators[payload.questionType](payload);
  return true;
}

module.exports = { validateQuestionPayload };