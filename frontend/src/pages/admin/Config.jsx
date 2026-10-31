import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch.js';
import { listConfigs, updateConfig } from '../../api/audit.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import { FormField, Input, Select, Textarea } from '../../components/Form.jsx';
import { CONFIG_GROUP_LABEL } from '../../utils/enums.js';
import { formatDateTime } from '../../utils/format.js';

/**
 * 系统参数配置（REQ-SYS-01）
 * 契约：GET /configs?group=、PUT /configs/{configKey}
 * isEditable=false 的参数不允许在线修改（后端 70101 拒绝）
 */
export default function AdminConfig() {
  const [group, setGroup] = useState('');
  const configs = useFetch(() => listConfigs(group ? { group } : {}), [group]);

  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openEdit = (item) => {
    setEditing(item);
    setValue(item.configValue ?? '');
    setReason('');
    setError('');
  };

  const validate = (item, raw) => {
    const text = String(raw).trim();
    if (!text) return '参数值不能为空';
    if (item.valueType === 'number' && Number.isNaN(Number(text))) return '该参数要求数字类型';
    if (item.valueType === 'boolean' && !['true', 'false'].includes(text)) return '布尔参数仅接受 true 或 false';
    if (item.valueType === 'json') {
      try {
        JSON.parse(text);
      } catch {
        return '该参数要求合法 JSON';
      }
    }
    return '';
  };

  const submit = async () => {
    const msg = validate(editing, value);
    if (msg) {
      setError(msg);
      return;
    }
    setSubmitting(true);
    try {
      await updateConfig(editing.configKey, String(value).trim(), reason.trim() || undefined);
      toast.success('参数已保存并即时生效');
      setEditing(null);
      configs.reload(true);
    } catch (err) {
      setError(err?.displayMessage || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const items = configs.data || [];

  return (
    <div className="page">
      <PageHeader
        title="系统参数"
        desc="维护默认考试时长、及格线、自动暂存间隔、防作弊阈值、令牌有效期与多选计分策略。变更即时生效并写入审计日志。"
        actions={
          <Select value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 160 }}>
            <option value="">全部参数组</option>
            {Object.entries(CONFIG_GROUP_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        }
      />

      <div className="alert-bar info" style={{ marginBottom: 16 }}>
        参数取值有服务端范围校验（超出返回 70102）。不可编辑参数（isEditable=false）仅展示，需通过环境变量或部署脚本调整。
      </div>

      {configs.loading ? (
        <Loading text="正在加载参数…" />
      ) : configs.error ? (
        <ErrorState message={configs.error} onRetry={() => configs.reload()} />
      ) : items.length === 0 ? (
        <div className="list-card">
          <div className="state-box">
            <span className="state-icon">◌</span>
            <span className="state-title">暂无系统参数</span>
            <span className="state-desc">请确认后端已执行 schema.sql 初始化脚本（含 sys_config 初始数据）。</span>
          </div>
        </div>
      ) : (
        <div className="list-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>参数键</th>
                  <th>参数值</th>
                  <th>类型</th>
                  <th>分组</th>
                  <th>说明</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.configKey}>
                    <td className="mono small">{item.configKey}</td>
                    <td><b className="mono">{item.configValue}</b></td>
                    <td><Tag tone="neutral">{item.valueType}</Tag></td>
                    <td className="small">{CONFIG_GROUP_LABEL[item.configGroup] || item.configGroup}</td>
                    <td className="small muted" style={{ maxWidth: 320 }}>{item.description || '—'}</td>
                    <td className="mono xs">{formatDateTime(item.updatedAt)}</td>
                    <td>
                      {item.isEditable ? (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>修改</Button>
                      ) : (
                        <Tag tone="amber">只读</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="list-meta">
            <span>共 {items.length} 项参数</span>
            <span className="xs">参数键为全局唯一标识，不支持在线修改参数键</span>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        title={`修改参数：${editing?.configKey || ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={submit}>保存并生效</Button>
          </>
        }
      >
        <FormField label="当前值" hint={editing?.description}>
          {(f) => <Input id={f.id} value={editing?.configValue ?? ''} disabled />}
        </FormField>
        <FormField label="新值" required error={error}>
          {(f) => (
            <Input
              id={f.id}
              invalid={Boolean(error)}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError('');
              }}
            />
          )}
        </FormField>
        <FormField label="变更原因" hint="写入审计日志，便于追溯配置漂移">
          {(f) => (
            <Textarea id={f.id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：教学例会决定将及格线调整为 60 分" />
          )}
        </FormField>
      </Modal>
    </div>
  );
}