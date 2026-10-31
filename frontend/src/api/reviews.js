import { get, post } from './http.js';

/**
 * 阅卷与复核 API（5 个端点）
 * operationId：listGradingTasks / getGradingTask / scoreGradingTask /
 * arbitrateGradingTask / getGradingProgress
 */

export const listGradingTasks = (params) => get('/grading-tasks', params);
export const getGradingTask = (taskId) => get(`/grading-tasks/${taskId}`);

/** 提交人工评分：得分必须在 0~该题满分 */
export const scoreGradingTask = (taskId, payload) => post(`/grading-tasks/${taskId}/score`, payload);

/** 争议仲裁（管理员 / 指定教研组长） */
export const arbitrateGradingTask = (taskId, payload) =>
  post(`/grading-tasks/${taskId}/arbitrate`, payload);

export const getGradingProgress = (examId) => get(`/exams/${examId}/grading-progress`);