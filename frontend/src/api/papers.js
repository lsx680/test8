import { del, get, patch, post, put } from './http.js';

/**
 * 试卷与组卷 API（12 个端点）
 * operationId：listPapers / createPaper / randomAssemblePaper / getPaper /
 * updatePaper / deletePaper / addPaperQuestions / updatePaperQuestions /
 * removePaperQuestion / previewPaper / copyPaper / updatePaperStatus
 */

export const listPapers = (params) => get('/papers', params);
export const createPaper = (payload) => post('/papers', payload);
export const randomAssemblePaper = (payload) => post('/papers/random', payload);
export const getPaper = (paperId) => get(`/papers/${paperId}`);
export const updatePaper = (paperId, payload) => put(`/papers/${paperId}`, payload);
export const deletePaper = (paperId) => del(`/papers/${paperId}`);
export const addPaperQuestions = (paperId, questions) =>
  post(`/papers/${paperId}/questions`, { questions });
export const updatePaperQuestions = (paperId, questions) =>
  put(`/papers/${paperId}/questions`, { questions });
export const removePaperQuestion = (paperId, paperQuestionId) =>
  del(`/papers/${paperId}/questions/${paperQuestionId}`);
export const previewPaper = (paperId) => get(`/papers/${paperId}/preview`);
export const copyPaper = (paperId, paperName) => post(`/papers/${paperId}/copy`, { paperName });
export const updatePaperStatus = (paperId, status, reason) =>
  patch(`/papers/${paperId}/status`, { status, reason });