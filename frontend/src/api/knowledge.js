import { get, patch, post, put } from './http.js';

/**
 * 知识点 API（4 个端点）
 * operationId：listKnowledgePoints / createKnowledgePoint /
 *              updateKnowledgePoint / updateKnowledgePointStatus
 */

/** 查询知识点树；includeArchived=true 时包含归档节点 */
export const listKnowledgePoints = (params) => get('/knowledge-points', params);

export const createKnowledgePoint = (payload) => post('/knowledge-points', payload);

export const updateKnowledgePoint = (kpId, payload) => put(`/knowledge-points/${kpId}`, payload);

export const updateKnowledgePointStatus = (kpId, status) =>
  patch(`/knowledge-points/${kpId}/status`, { status });