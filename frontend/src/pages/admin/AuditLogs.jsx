import { useState } from 'react';
import { usePaginated } from '../../hooks/usePaginated.js';
import { exportAuditLogs, listAuditLogs } from '../../api/audit.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Pagination from '../../components/Pagination.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import { Input, Select } from '../../components/Form.jsx';
import { downloadBlob, formatDateTime, truncate } from '../../utils/format.js';
import { ROLE_LABEL } from '../../utils/enums.js';
import { fromDateTimeLocal } from '../../utils/format.js';

const MODULE_OPTIONS = [
  ['uam', '用户与权限'],
  ['qbm', '题库管理'],
  ['ppm', '试卷与组卷'],
  ['exm', '考试与答题'],
  ['mrk', '阅卷与复核'],
  ['sta', '成绩统计'],
  ['sys', '系统管理'],
];

/**
 * 审计日志（REQ-SYS-03）
 * 契约：GET /audit-logs（默认最近 30 天）、GET /audit-logs/export（CSV）
 * 日志只读，非管理员不可访问（菜单与路由守卫 + 服务端 403 双重约束）
 */
export default function AdminAuditLogs() {
  const [draft, setDraft] = useState({ module: '', result: '', action: '', userId: '', startTime: '', endTime: '' });
  const [detail, setDetail] = useState(null);
  const [exporting, setExporting] = useState(false);

  const page = usePaginated(listAuditLogs, {
    initialFilters: {},
    pageSize: 20,
  });

  const apply = () => {
    page.setFilters({
      module: draft.module,
      result: draft.result,
      action: draft.action.trim(),
      userId: draft.userId,
      startTime: fromDateTimeLocal(draft.startTime) || '',
      endTime: fromDateTimeLocal(draft.endTime) || '',
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportAuditLogs({
        ...(draft.startTime ? { startTime: fromDateTimeLocal(draft.startTime) } : {}),
        ...(draft.endTime ? { endTime: fromDateTimeLocal(draft.endTime) } : {}),
      });
      downloadBlob(blob, `audit-logs-${Date.now()}.csv`);
      toast.success('审计日志已导出（导出行为本身也已记录）');
    } catch (err) {
      toast.error(err?.displayMessage || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    {
      key: 'createdAt',
      title: '时间',
      render: (l) => <span className="mono xs">{formatDateTime(l.createdAt)}</span>,
    },
    {
      key: 'user',
      title: '操作人',
      render: (l) => (
        <div>
          <div className="small strong">{l.username || '系统'}</div>
          <div className="xs muted">{ROLE_LABEL[l.roleCode] || l.roleCode || '—'}</div>
        </div>
      ),
    },
    { key: 'module', title: '模块', render: (l) => <Tag tone="violet">{(l.module || '—').toUpperCase()}</Tag> },
    { key: 'action', title: '动作', render: (l) => <span className="small mono">{l.action}</span> },
    {
      key: 'path',
      title: '接口',
      render: (l) => (
        <span className="small mono muted">
          {l.httpMethod || '—'} {truncate(l.path || '', 42)}
        </span>
      ),
    },
    {
      key: 'result',
      title: '结果',
      render: (l) => <Tag tone={l.result === 'success' ? 'green' : 'red'}>{l.result === 'success' ? '成功' : '失败'}</Tag>,
    },
    { key: 'ip', title: 'IP', render: (l) => <span className="mono xs">{l.ip || '—'}</span> },
    { key: 'durationMs', title: '耗时', render: (l) => <span className="mono xs">{l.durationMs != null ? `${l.durationMs}ms` : '—'}</span> },
    {
      key: 'actions',
      title: '',
      render: (l) => (
        <Button size="sm" variant="ghost" onClick={() => setDetail(l)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="审计日志"
        desc="记录登录、数据变更、权限调整、标准答案修正、成绩发布与导出等敏感操作，日志只读且不可被非管理员修改。"
        actions={
          <Button variant="secondary" loading={exporting} onClick={handleExport}>
            导出 CSV
          </Button>
        }
      />

      <div className="toolbar">
        <div className="toolbar-item">
          <span>开始时间</span>
          <Input type="datetime-local" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
        </div>
        <div className="toolbar-item">
          <span>结束时间</span>
          <Input type="datetime-local" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
        </div>
        <div className="toolbar-item">
          <span>模块</span>
          <Select value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })}>
            <option value="">全部模块</option>
            {MODULE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </div>
        <div className="toolbar-item">
          <span>结果</span>
          <Select value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value })}>
            <option value="">全部结果</option>
            <option value="success">成功</option>
            <option value="failure">失败</option>
          </Select>
        </div>
        <div className="toolbar-item">
          <span>动作</span>
          <Input placeholder="如 login / updateStatus" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        </div>
        <div className="toolbar-item" style={{ minWidth: 100 }}>
          <span>操作人 ID</span>
          <Input type="number" min="1" value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })} />
        </div>
        <div className="toolbar-actions">
          <Button variant="primary" size="sm" onClick={apply}>查询</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft({ module: '', result: '', action: '', userId: '', startTime: '', endTime: '' });
              page.resetFilters({});
            }}
          >
            重置
          </Button>
        </div>
      </div>

      <div className="list-card">
        <Table
          columns={columns}
          rows={page.list}
          loading={page.loading}
          error={page.error}
          onRetry={page.reload}
          emptyTitle="没有符合条件的审计记录"
          emptyDesc="默认查询最近 30 天的日志，可调整时间范围后重试。"
        />
        <Pagination
          page={page.page}
          pageSize={page.pageSize}
          total={page.total}
          onChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>

      <Modal
        open={Boolean(detail)}
        title="审计记录详情"
        onClose={() => setDetail(null)}
        wide
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>关闭</Button>}
      >
        {detail ? (
          <div className="detail-grid">
            <div className="detail-item"><span>记录 ID</span><b className="mono">{detail.id}</b></div>
            <div className="detail-item"><span>时间</span><b className="mono">{formatDateTime(detail.createdAt)}</b></div>
            <div className="detail-item"><span>操作人</span><b>{detail.username || '系统'}（{detail.userId ?? '—'}）</b></div>
            <div className="detail-item"><span>角色</span><b>{ROLE_LABEL[detail.roleCode] || detail.roleCode || '—'}</b></div>
            <div className="detail-item"><span>模块 / 动作</span><b>{detail.module} / {detail.action}</b></div>
            <div className="detail-item"><span>接口</span><b className="mono">{detail.httpMethod} {detail.path}</b></div>
            <div className="detail-item"><span>结果</span><b>{detail.result}{detail.errorCode ? `（${detail.errorCode}）` : ''}</b></div>
            <div className="detail-item"><span>来源 IP</span><b className="mono">{detail.ip || '—'}</b></div>
            <div className="detail-item"><span>耗时</span><b className="mono">{detail.durationMs != null ? `${detail.durationMs}ms` : '—'}</b></div>
            <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
              <span>请求摘要</span>
              <b style={{ fontWeight: 500, lineHeight: 1.7 }}>{detail.requestSummary || '—'}</b>
            </div>
            <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
              <span>User-Agent</span>
              <b style={{ fontWeight: 400, fontSize: 12, wordBreak: 'break-all' }}>{detail.userAgent || '—'}</b>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}