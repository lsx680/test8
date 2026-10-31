import { get, http, post } from './http.js';

/**
 * 成绩与统计 API（13 个端点）
 * operationId：listMyGrades / exportMyGrades / getMyGradeDetail / listExamScores /
 * exportExamScores / publishScores / getExamStatistics / getQuestionAnalysis /
 * getTrendStatistics / getKnowledgePointStatistics / listAppeals / createAppeal /
 * handleAppeal
 */

export const listMyGrades = (params) => get('/my/grades', params);

/** 导出本人成绩单（Excel Blob） */
export const exportMyGrades = () =>
  http.get('/my/grades/export', { responseType: 'blob', timeout: 60000 });

export const getMyGradeDetail = (attemptId) => get(`/my/grades/${attemptId}`);

export const listExamScores = (examId, params) => get(`/exams/${examId}/scores`, params);

/** 导出考试成绩表（Excel Blob） */
export const exportExamScores = (examId, params) =>
  http.get(`/exams/${examId}/scores/export`, { params, responseType: 'blob', timeout: 60000 });

export const publishScores = (examId) => post(`/exams/${examId}/publish-scores`);

export const getExamStatistics = (examId) => get(`/exams/${examId}/statistics`);
export const getQuestionAnalysis = (examId) => get(`/exams/${examId}/question-analysis`);

/** 多场次趋势：examIds 逗号分隔 */
export const getTrendStatistics = (params) => get('/statistics/trends', params);

/** 知识点失分分布 */
export const getKnowledgePointStatistics = (examId) =>
  get('/statistics/knowledge-points', { examId });

export const listAppeals = (params) => get('/appeals', params);
export const createAppeal = (payload) => post('/appeals', payload);
export const handleAppeal = (appealId, payload) => post(`/appeals/${appealId}/handle`, payload);