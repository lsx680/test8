import { get, post, put } from './http.js';

/**
 * 在线答题 API（8 个端点）
 * operationId：startAttempt / recoverAttempt / getAttemptQuestions / getRemainingTime /
 * saveAnswers / reportAntiCheatEvent / submitAttempt / gradeAttempt
 *
 * 计时与答案保护要点：
 * - 剩余时间以服务端返回为权威，客户端仅展示
 * - 题目接口不返回标准答案与解析
 * - 答案暂存与交卷接口均为幂等
 */

/** 开考：服务端校验参考名单/时间窗/次数，并创建唯一答卷 */
export const startAttempt = (examId, deviceKey) =>
  post(`/exams/${examId}/attempts`, deviceKey ? { deviceKey } : {});

/** 断线重连：恢复剩余时间、题目与已保存答案 */
export const recoverAttempt = (attemptId) => get(`/attempts/${attemptId}`);

/** 取题（已脱敏） */
export const getAttemptQuestions = (attemptId) => get(`/attempts/${attemptId}/questions`);

/** 服务端权威计时校准（每 30 秒调用） */
export const getRemainingTime = (attemptId) =>
  get(`/attempts/${attemptId}/remaining-time`, undefined, { silent: true });

/**
 * 答案暂存（增量、幂等）
 * @param {number} attemptId
 * @param {Array<{questionId:number, answer:string[], answerVersion?:number}>} answers
 */
export const saveAnswers = (attemptId, answers) =>
  put(`/attempts/${attemptId}/answers`, { answers }, { silent: true });

/** 上报防作弊事件 */
export const reportAntiCheatEvent = (attemptId, payload) =>
  post(`/attempts/${attemptId}/cheat-events`, payload, { silent: true });

/** 交卷（幂等）；submitType: manual | timeout */
export const submitAttempt = (attemptId, submitType = 'manual') =>
  post(`/attempts/${attemptId}/submit`, { submitType });

/** 触发/重放自动判分（仅管理员） */
export const gradeAttempt = (attemptId) => post(`/attempts/${attemptId}/grade`);