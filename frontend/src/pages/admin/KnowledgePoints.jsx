import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch.js';
import {
  createKnowledgePoint,
  listKnowledgePoints,
  updateKnowledgePoint,
  updateKnowledgePointStatus,
} from '../../api/knowledge.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Tag from '../../components/Tag.jsx';
import Button from '../../components/Button.jsx';
import Modal from '../../components/Modal.jsx';
import { FormField, Input, Select } from '../../components/Form.jsx';
import { integerRange, maxLen, required, runRules } from '../../utils/validate.js';

const EMPTY = { kpCode: '', kpName: '', parentId: '', level: 1, sortOrder: 0 };

/**
 * 知识点字典维护（REQ-QBM-07）
 * 契约：GET/POST /knowledge-points、PUT /knowledge-points/{kpId}、
 *      PATCH /knowledge-points/{kpId}/status
 * 已被题目引用的知识点只能归档，不能物理删除（契约无删除端点）。
 */
export default function AdminKnowledgePoints() {
  const [includeArchived, setIncludeArchived] = useState(true);
  const list = useFetch(() => listKnowledgePoints({ includeArchived }), [includeArchived]);

  const [modal, setModal] = useState(null); // { mode:'create'|'edit', node }
  const [form, setForm] = useState(EMPTY);
  const [errs, setErrs] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const nodes = list.data || [];
  const rows = [];
  nodes.forEach((parent) => {
    rows.push({ ...parent, _level: 1 });
    (parent.children || []).forEach((child) => rows.push({ ...child, _level: 2, _parentName: parent.kpName }));
  });

  const openCreate = (parent = null) => {
    setForm({ ...EMPTY, parentId: parent?.id ?? '', level: parent ? 2 : 1 });
    setErrs({});
    setModal({ mode: 'create', node: parent });
  };

  const openEdit = (node) => {
    setForm({
      kpCode: node.kpCode || '',
      kpName: node.kpName || '',
      parentId: node.parentId ?? '',
      level: node.level || 1,
      sortOrder: node.sortOrder ?? 0,
    });
    setErrs({});
    setModal({ mode: 'edit', node });
  };

  const submit = async () => {
    const result = runRules(form, {
      kpName: [(v) => required(v, '知识点名称'), (v) => maxLen(v, 64, '知识点名称')],
      kpCode: [(v) => maxLen(v, 32, '知识点编码')],
      sortOrder: [(v) => integerRange(v, 0, 9999, '排序号')],
      parentId: [(v, values) => (Number(values.level) === 2 ? required(v, '父级知识点') : null)],
    });
    setErrs(result.errors);
    if (!result.valid) return;

    const payload = {
      kpName: form.kpName.trim(),
      level: Number(form.level),
      sortOrder: Number(form.sortOrder) || 0,
      ...(form.kpCode ? { kpCode: form.kpCode.trim() } : {}),
      ...(Number(form.level) === 2 ? { parentId: Number(form.parentId) } : {}),
    };

    setSubmitting(true);
    try {
      if (modal.mode === 'create') {
        await createKnowledgePoint(payload);
        toast.success('知识点已创建');
      } else {
        await updateKnowledgePoint(modal.node.id, payload);
        toast.success('知识点已更新');
      }
      setModal(null);
      list.reload(true);
    } catch (err) {
      toast.error(err?.displayMessage || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (node) => {
    const next = node.status === 'active' ? 'archived' : 'active';
    try {
      await updateKnowledgePointStatus(node.id, next);
      toast.success(next === 'archived' ? '已归档，题目引用关系保留' : '已启用');
      list.reload(true);
    } catch (err) {
      toast.error(err?.displayMessage || '状态更新失败');
    }
  };

  const columns = [
    {
      key: 'kpName',
      title: '知识点',
      render: (row) => (
        <span style={{ paddingLeft: row._level === 2 ? 22 : 0 }}>
          {row._level === 2 ? <span className="muted">└ </span> : null}
          <b style={{ fontWeight: row._level === 1 ? 650 : 500 }}>{row.kpName}</b>
        </span>
      ),
    },
    { key: 'kpCode', title: '编码', render: (row) => <span className="mono xs">{row.kpCode || '—'}</span> },
    {
      key: 'level',
      title: '层级',
      render: (row) => <Tag tone={row._level === 1 ? 'violet' : 'neutral'}>{row._level === 1 ? '一级' : '二级'}</Tag>,
    },
    { key: 'questionCount', title: '引用题目', render: (row) => <span className="mono">{row.questionCount ?? 0}</span> },
    { key: 'sortOrder', title: '排序', render: (row) => <span className="mono">{row.sortOrder ?? 0}</span> },
    {
      key: 'status',
      title: '状态',
      render: (row) => <Tag tone={row.status === 'active' ? 'green' : 'amber'}>{row.status === 'active' ? '启用' : '已归档'}</Tag>,
    },
    {
      key: 'actions',
      title: '操作',
      render: (row) => (
        <div className="cell-actions">
          {row._level === 1 ? (
            <Button size="sm" variant="ghost" onClick={() => openCreate(row)}>
              添加子级
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toggleStatus(row)}>
            {row.status === 'active' ? '归档' : '启用'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="知识点维护"
        desc="维护两级知识点字典，供题目关联与统计维度使用。已被题目引用的知识点只能归档，不可物理删除。"
        actions={
          <>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              显示归档
            </label>
            <Button variant="primary" onClick={() => openCreate(null)}>
              + 新增一级知识点
            </Button>
          </>
        }
      />

      <div className="list-card">
        <Table
          columns={columns}
          rows={rows}
          loading={list.loading}
          error={list.error}
          onRetry={() => list.reload()}
          emptyTitle="暂无知识点"
          emptyDesc="先创建一级知识点，再为其添加二级子节点。"
        />
        <div className="list-meta">
          <span>共 {rows.length} 个节点（一级 {nodes.length} / 二级 {rows.length - nodes.length}）</span>
          <span className="xs">知识点为全局字典，仅管理员可维护（权限矩阵第 9 项）</span>
        </div>
      </div>

      <Modal
        open={Boolean(modal)}
        title={modal?.mode === 'create' ? '新增知识点' : '编辑知识点'}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={submit}>保存</Button>
          </>
        }
      >
        <div className="form-grid-2">
          <FormField label="名称" required error={errs.kpName}>
            {(f) => (
              <Input id={f.id} invalid={f.invalid} value={form.kpName} onChange={(e) => setForm({ ...form, kpName: e.target.value })} />
            )}
          </FormField>
          <FormField label="编码" error={errs.kpCode} hint="留空时由服务端自动生成">
            {(f) => (
              <Input id={f.id} invalid={f.invalid} value={form.kpCode} onChange={(e) => setForm({ ...form, kpCode: e.target.value })} />
            )}
          </FormField>
          <FormField label="层级" required>
            {(f) => (
              <Select
                id={f.id}
                value={form.level}
                onChange={(e) => setForm({ ...form, level: Number(e.target.value), parentId: e.target.value === '1' ? '' : form.parentId })}
              >
                <option value={1}>一级</option>
                <option value={2}>二级</option>
              </Select>
            )}
          </FormField>
          <FormField label="父级知识点" required={Number(form.level) === 2} error={errs.parentId}>
            {(f) => (
              <Select
                id={f.id}
                invalid={f.invalid}
                disabled={Number(form.level) === 1}
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              >
                <option value="">{Number(form.level) === 1 ? '不适用' : '请选择父级'}</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.kpName}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="排序号" error={errs.sortOrder}>
            {(f) => (
              <Input id={f.id} type="number" min="0" invalid={f.invalid} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
            )}
          </FormField>
        </div>
        {Number(form.level) === 2 && modal?.mode === 'edit' ? (
          <div className="alert-bar">修改层级可能导致子节点关系不一致，建议仅调整名称与排序。</div>
        ) : null}
      </Modal>
    </div>
  );
}