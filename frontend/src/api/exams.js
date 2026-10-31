import { get, patch, post, put } from './http.js';

/**
 * 考试管理 API（11 个端点）
 * operationId：listExams / createExam / listAvailableExams / getExam / updateExam /
 * publishExam / updateExamStatus / listExamTasks / grantExtraAttempts /
 * getExamMonitor / listAntiCheatEvents
 */

export const listExams = (params) => get('/exams', params);
export const createExam = (payload) => post('/exams', payload);
export const listAvailableExams = (params) => get('/exams/available', params);
export const getExam = (examId) => get(`/exams/${examId}`);
export const updateExam = (examId, payload) => put(`/exams/${examId}`, payload);
export const publishExam = (examId) => post(`/exams/${examId}/publish`);
export const updateExamStatus = (examId, payload) => patch(`/exams/${examId}/status`, payload);
export const listExamTasks = (examId, params) => get(`/exams/${examId}/tasks`, params);
export const grantExtraAttempts = (examId, payload) => post(`/exams/${examId}/grants`, payload);
export const getExamMonitor = (examId) => get(`/exams/${examId}/monitor`);
export const listAntiCheatEvents = (examId, params) =>
  get(`/exams/${examId}/anti-cheat-events`, params);