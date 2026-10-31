'use strict';

/** 知识点服务（两级树，仅管理员维护） */
const knowledgeModel = require('../models/knowledge.model');
const auditModel = require('../models/audit.model');
const { fail } = require('../utils/errors');

async function listTree({ includeArchived = false } = {}) {
  const rows = await knowledgeModel.list(includeArchived);
  const roots = [];
  const nodeMap = new Map();
  rows.forEach((row) => nodeMap.set(row.id, { ...row, children: [] }));
  rows.forEach((row) => {
    const node = nodeMap.get(row.id);
    if (row.parentId && nodeMap.has(row.parentId)) {
      nodeMap.get(row.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

async function create(payload, operatorId) {
  let level = payload.level;
  let parentId = payload.parentId || null;
  if (parentId) {
    const parent = await knowledgeModel.findById(parentId);
    if (!parent) throw fail(90401, { message: '父级知识点不存在' });
    if (parent.level !== 1) throw fail(90101, { errors: [{ field: 'parentId', message: '仅支持两级知识点，父级必须为一级' }] });
    level = 2;
  } else {
    level = 1;
  }
  const duplicate = await knowledgeModel.findByParentAndName(parentId, payload.kpName);
  if (duplicate) throw fail(90409, { message: '同级下知识点名称重复' });

  const kpCode = payload.kpCode || (await knowledgeModel.generateCode(parentId));
  const id = await knowledgeModel.create({ ...payload, kpCode, parentId, level }, operatorId);
  await auditModel.write({
    userId: operatorId,
    module: 'qbm',
    action: 'kp.create',
    requestSummary: { kpId: id, kpName: payload.kpName },
    result: 'success',
  });
  return knowledgeModel.findById(id);
}

async function update(kpId, payload, operatorId) {
  const existing = await knowledgeModel.findById(kpId);
  if (!existing) throw fail(90401);
  let parentId = payload.parentId || null;
  let level = payload.level;
  if (parentId) {
    if (Number(parentId) === Number(kpId)) throw fail(90101, { errors: [{ field: 'parentId', message: '父级不能是自身' }] });
    const parent = await knowledgeModel.findById(parentId);
    if (!parent || parent.level !== 1) throw fail(90101, { errors: [{ field: 'parentId', message: '父级必须为有效的一级知识点' }] });
    level = 2;
  } else {
    level = 1;
  }
  const duplicate = await knowledgeModel.findByParentAndName(parentId, payload.kpName);
  if (duplicate && duplicate.id !== Number(kpId)) throw fail(90409, { message: '同级下知识点名称重复' });

  await knowledgeModel.update(kpId, {
    ...payload,
    parentId,
    level,
    kpCode: payload.kpCode || existing.kpCode,
  });
  await auditModel.write({
    userId: operatorId,
    module: 'qbm',
    action: 'kp.update',
    requestSummary: { kpId, kpName: payload.kpName },
    result: 'success',
  });
  return knowledgeModel.findById(kpId);
}

async function updateStatus(kpId, status, operatorId) {
  const existing = await knowledgeModel.findById(kpId);
  if (!existing) throw fail(90401);
  // 被引用时禁止物理删除，本接口仅归档；归档前确认引用数只做提示，不阻断
  const affected = await knowledgeModel.updateStatus(kpId, status);
  if (affected === 0) throw fail(90409);
  await knowledgeModel.refreshQuestionCount(kpId);
  await auditModel.write({
    userId: operatorId,
    module: 'qbm',
    action: 'kp.status',
    requestSummary: { kpId, status, questionCount: existing.questionCount },
    result: 'success',
  });
  return knowledgeModel.findById(kpId);
}

module.exports = { listTree, create, update, updateStatus };