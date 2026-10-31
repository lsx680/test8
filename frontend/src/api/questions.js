import { del, get, http, post, put } from './http.js';

/**
 * 题库与题目 API（15 个端点）
 * operationId：listQuestionBanks / createQuestionBank / updateQuestionBank /
 * deleteQuestionBank / authorizeQuestionBank / listQuestions / createQuestion /
 * getQuestion / updateQuestion / deleteQuestion / listQuestionVersions /
 * getQuestionReferences / importQuestions / exportQuestions / rejudgeQuestion
 */

export const listQuestionBanks = (params) => get('/question-banks', params);
export const createQuestionBank = (payload) => post('/question-banks', payload);
export const updateQuestionBank = (bankId, payload) => put(`/question-banks/${bankId}`, payload);
export const deleteQuestionBank = (bankId) => del(`/question-banks/${bankId}`);
export const authorizeQuestionBank = (bankId, payload) =>
  post(`/question-banks/${bankId}/authorizations`, payload);

export const listQuestions = (params) => get('/questions', params);
export const createQuestion = (payload) => post('/questions', payload);
export const getQuestion = (questionId) => get(`/questions/${questionId}`);
export const updateQuestion = (questionId, payload) => put(`/questions/${questionId}`, payload);
export const deleteQuestion = (questionId) => del(`/questions/${questionId}`);
export const listQuestionVersions = (questionId) => get(`/questions/${questionId}/versions`);
export const getQuestionReferences = (questionId) => get(`/questions/${questionId}/references`);

/**
 * 批量导入：multipart/form-data
 * @param {{file: File, bankId:number|string, knowledgePointId?:number|string, defaultScore?:number|string}} payload
 */
export const importQuestions = (payload) => {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('bankId', String(payload.bankId));
  if (payload.knowledgePointId) form.append('knowledgePointId', String(payload.knowledgePointId));
  if (payload.defaultScore !== undefined && payload.defaultScore !== '') {
    form.append('defaultScore', String(payload.defaultScore));
  }
  return http.post('/questions/import', form, {
    // 不手动指定 Content-Type：交给浏览器生成 multipart boundary
    timeout: 60000,
  });
};

/** 导出题库 Excel：返回 Blob */
export const exportQuestions = (params) =>
  http.get('/questions/export', { params, responseType: 'blob', timeout: 60000 });

/** 修正标准答案并批量重判（仅管理员） */
export const rejudgeQuestion = (questionId, payload) =>
  post(`/questions/${questionId}/rejudge`, payload);