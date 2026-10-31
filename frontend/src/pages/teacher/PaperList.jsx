import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaginated } from '../../hooks/usePaginated.js';
import {
  copyPaper,
  deletePaper,
  listPapers,
  previewPaper,
  updatePaperStatus,
} from '../../api/papers.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Pagination from '../../components/Pagination.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import Loading from '../../components/Loading.jsx';
import { Input, Select } from '../../components/Form.jsx';
import { formatDateTime, formatMinutes, formatScore } from '../../utils/format.js';
import { PAPER_STATUS_LABEL, PAPER_STATUS_TAG, QUESTION_TYPE_LABEL } from '../../utils/enums.js';

/**
 * 试卷列表（REQ-PPM-03/05/06/07）
 * 契约：GET /papers、POST /papers/{id}/copy、PATCH /papers/{id}/status、
 *      GET /papers/{id}/preview、DELETE /papers/{id}
 * 说明：归档（archived）仅管理员可执行，教师端不展示该操作。
 */
export default function PaperList() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const papers = usePaginated(listPapers, { initialFilters: { keyword: '', status: '' } });

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const openPreview = async (paper) => {
    setPreview({ paper, data: null });
    setPreviewLoading(true);
    try {
      const data = await previewPaper(paper.id);
      setPreview({ paper, data });
    } catch (err) {
      toast.error(err?.displayMessage || '预览加载失败');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const doCopy = async (paper) => {
    const name = window.prompt('请输入复制后的试卷名称', `${paper.paperName}（副本）`);
    if (!name) return;
    setBusyId(paper.id);
    try {
      const result = await copyPaper(paper.id, name);
      toast.success('试卷已复制，可独立编辑顺序与分值');
      papers.reload();
      if (result?.id) navigate(`/teacher/papers/${result.id}/edit`);
    } catch (err) {
      toast.error(err?.displayMessage || '复制失败');
    } finally {
      setBusyId(null);
    }
  };

  const toggleLock = async (paper) => {
    const next = paper.status === 'locked' ? 'published' : 'locked';
    setBusyId(paper.id);
    try {
      await updatePaperStatus(paper.id, next, next === 'locked' ? '教师手动锁定' : '解除锁定');
      toast.success(next === 'locked' ? '试卷已锁定，禁止改题目与分值' : '已解除锁定');
      papers.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '状态更新失败');
    } finally {
      setBusyId(null);
    }
  };

  const removePaper = async (paper) => {
    if (!window.confirm(`确认删除试卷「${paper.paperName}」？已被考试引用时将拒绝删除。`)) return;
    setBusyId(paper.id);
    try {
      await deletePaper(paper.id);
      toast.success('试卷已删除（软删除）');
      papers.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    {
      key: 'paper',
      title: '试卷',
      render: (p) => (
        <div>
          <div className="strong">{p.paperName}</div>
          <div className="xs muted mono">{p.paperNo} · {p.assemblyMode === 'random' ? '随机组卷' : '手动组卷'}</div>
        </div>
      ),
    },
    { key: 'questionCount', title: '题数', render: (p) => <span className="mono">{p.questionCount}</span> },
    { key: 'totalScore', title: '总分', render: (p) => <span className="mono">{formatScore(p.totalScore)}</span> },
    { key: 'durationMinutes', title: '建议时长', render: (p) => formatMinutes(p.durationMinutes) },
    { key: 'usedCount', title: '使用次数', render: (p) => <span className="mono">{p.usedCount ?? 0}</span> },
    {
      key: 'status',
      title: '状态',
      render: (p) => (
        <Tag tone={PAPER_STATUS_TAG[p.status]?.replace('tag-', '') || 'neutral'}>
          {PAPER_STATUS_LABEL[p.status] || p.status}
        </Tag>
      ),
    },
    { key: 'updatedAt', title: '更新时间', render: (p) => <span className="mono xs">{formatDateTime(p.updatedAt)}</span> },
    {
      key: 'actions',
      title: '操作',
      render: (p) => (
        <div className="cell-actions">
          <Button size="sm" variant="ghost" onClick={() => openPreview(p)}>预览</Button>
          <Button size="sm" variant="ghost" disabled={p.status === 'locked'} onClick={() => navigate(`/teacher/papers/${p.id}/edit`)}>
            编辑
          </Button>
          <Button size="sm" variant="ghost" loading={busyId === p.id} onClick={() => doCopy(p)}>复制</Button>
          <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => toggleLock(p)}>
            {p.status === 'locked' ? '解锁' : '锁定'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/teacher/exams/new?paperId=${p.id}`)}>创建考试</Button>
          <Button size="sm" variant="ghost" disabled={p.status === 'locked'} onClick={() => removePaper(p)}>删除</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="试卷管理"
        desc="试卷被考试引用后自动锁定，禁止修改题目与分值；归档仅管理员可执行，归档后不可用于新建考试。"
        actions={<Button variant="primary" onClick={() => navigate('/teacher/papers/new')}>+ 新建试卷</Button>}
      />

      <div className="toolbar">
        <div className="toolbar-item grow">
          <span>关键词</span>
          <Input
            placeholder="试卷名称 / 编号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && papers.setFilters({ keyword, status })}
          />
        </div>
        <div className="toolbar-item">
          <span>状态</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(PAPER_STATUS_LABEL).filter(([v]) => v !== 'deleted').map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div className="toolbar-actions">
          <Button variant="primary" size="sm" onClick={() => papers.setFilters({ keyword, status })}>查询</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKeyword('');
              setStatus('');
              papers.resetFilters({ keyword: '', status: '' });
            }}
          >
            重置
          </Button>
        </div>
      </div>

      <div className="list-card">
        <Table
          columns={columns}
          rows={papers.list}
          loading={papers.loading}
          error={papers.error}
          onRetry={papers.reload}
          emptyTitle="暂无试卷"
          emptyDesc="通过手动组卷或规则化随机组卷创建第一份试卷。"
        />
        <Pagination page={papers.page} pageSize={papers.pageSize} total={papers.total} onChange={papers.setPage} onPageSizeChange={papers.setPageSize} />
      </div>

      <Modal
        open={Boolean(preview)}
        title={`试卷预览（考生视角）· ${preview?.paper?.paperName || ''}`}
        onClose={() => setPreview(null)}
        wide
        footer={<Button variant="secondary" onClick={() => setPreview(null)}>关闭</Button>}
      >
        {previewLoading ? (
          <Loading text="正在生成考生视角预览…" />
        ) : preview?.data ? (
          <>
            <div className="alert-bar info" style={{ marginBottom: 14 }}>
              预览不展示标准答案与解析（REQ-PPM-04 / NFR-08）。总分 {formatScore(preview.data.totalScore)} 分，建议时长 {formatMinutes(preview.data.durationMinutes)}。
            </div>
            {preview.data.questions?.map((q, i) => (
              <div key={q.questionId || i} style={{ padding: '14px 0', borderBottom: '1px dashed var(--oe-core-border)' }}>
                <div className="row-between">
                  <b className="small">{i + 1}. {QUESTION_TYPE_LABEL[q.questionType] || q.questionType}</b>
                  <span className="mono small">{formatScore(q.score)} 分</span>
                </div>
                <p className="small" style={{ marginTop: 6, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{q.stem}</p>
                {q.options?.length ? (
                  <div style={{ marginTop: 8 }}>
                    {q.options.map((opt) => (
                      <div className="opt-readonly" key={opt.key}>
                        <b>{opt.key}.</b>
                        <span>{opt.content}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </>
        ) : null}
      </Modal>
    </div>
  );
}