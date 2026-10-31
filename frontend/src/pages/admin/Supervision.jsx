import { useState } from 'react';
import { usePaginated } from '../../hooks/usePaginated.js';
import { getExam, getExamMonitor, listExams } from '../../api/exams.js';
import { getPaper, listPapers, previewPaper } from '../../api/papers.js';

import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Pagination from '../../components/Pagination.jsx';
import Tag from '../../components/Tag.jsx';
import Button from '../../components/Button.jsx';
import Modal from '../../components/Modal.jsx';
import Loading from '../../components/Loading.jsx';
import { Input, Select } from '../../components/Form.jsx';
import { formatDateTime, formatMinutes, formatScore } from '../../utils/format.js';
import {
  EXAM_STATUS_LABEL,
  EXAM_STATUS_TAG,
  PAPER_STATUS_LABEL,
  PAPER_STATUS_TAG,
  SCORE_STATUS_LABEL,
  QUESTION_TYPE_LABEL,
} from '../../utils/enums.js';
import { tagClass } from '../../utils/enums.js';

/**
 * 考试与试卷监管（只读）
 * 权限矩阵：管理员可查看全量考试/试卷（第 11、12、17 项），但不代教师组卷、发考。
 * 契约：GET /exams、GET /exams/{id}、GET /exams/{id}/monitor、
 *      GET /papers、GET /papers/{id}、GET /papers/{id}/preview
 */
export default function AdminSupervision() {
  const [tab, setTab] = useState('exams');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState(null); // { kind:'exam'|'paper', loading, data, monitor, error }

  const exams = usePaginated(listExams, { initialFilters: { keyword: '', status: '' } });
  const papers = usePaginated(listPapers, { initialFilters: { keyword: '', status: '' } });

  const openExam = async (exam) => {
    setDetail({ kind: 'exam', loading: true, data: null, monitor: null, error: '' });
    try {
      const [data, monitor] = await Promise.all([
        getExam(exam.id),
        getExamMonitor(exam.id).catch(() => null),
      ]);
      setDetail({ kind: 'exam', loading: false, data, monitor, error: '' });
    } catch (err) {
      setDetail({ kind: 'exam', loading: false, data: null, monitor: null, error: err?.displayMessage || '考试详情加载失败' });
    }
  };

  const openPaper = async (paper) => {
    setDetail({ kind: 'paper', loading: true, data: null, monitor: null, error: '' });
    try {
      const [data, preview] = await Promise.all([
        getPaper(paper.id),
        previewPaper(paper.id).catch(() => null),
      ]);
      setDetail({ kind: 'paper', loading: false, data, preview, error: '' });
    } catch (err) {
      setDetail({ kind: 'paper', loading: false, data: null, preview: null, error: err?.displayMessage || '试卷详情加载失败' });
    }
  };

  const examColumns = [
    {
      key: 'exam',
      title: '考试',
      render: (e) => (
        <div>
          <div className="strong">{e.examName}</div>
          <div className="xs muted mono">{e.examNo}</div>
        </div>
      ),
    },
    { key: 'paperName', title: '试卷', render: (e) => <span className="small">{e.paperName || '—'}</span> },
    { key: 'ownerName', title: '创建教师', render: (e) => e.ownerName || '—' },
    {
      key: 'window',
      title: '考试窗口',
      render: (e) => (
        <span className="xs mono">
          {formatDateTime(e.startTime)} ~ {formatDateTime(e.endTime)}
        </span>
      ),
    },
    { key: 'durationMinutes', title: '时长', render: (e) => formatMinutes(e.durationMinutes) },
    {
      key: 'status',
      title: '状态',
      render: (e) => <Tag tone={tagClass(EXAM_STATUS_TAG, e.status).replace('tag-', '')}>{EXAM_STATUS_LABEL[e.status] || e.status}</Tag>,
    },
    {
      key: 'scoreStatus',
      title: '成绩',
      render: (e) => <Tag tone={e.scoreStatus === 'published' ? 'green' : 'amber'}>{SCORE_STATUS_LABEL[e.scoreStatus] || e.scoreStatus}</Tag>,
    },
    {
      key: 'actions',
      title: '',
      render: (e) => (
        <Button size="sm" variant="ghost" onClick={() => openExam(e)}>
          查看详情
        </Button>
      ),
    },
  ];

  const paperColumns = [
    {
      key: 'paper',
      title: '试卷',
      render: (p) => (
        <div>
          <div className="strong">{p.paperName}</div>
          <div className="xs muted mono">{p.paperNo}</div>
        </div>
      ),
    },
    { key: 'ownerName', title: '创建教师', render: (p) => p.ownerName || '—' },
    { key: 'assemblyMode', title: '组卷方式', render: (p) => (p.assemblyMode === 'random' ? '随机组卷' : '手动组卷') },
    { key: 'questionCount', title: '题数', render: (p) => <span className="mono">{p.questionCount}</span> },
    { key: 'totalScore', title: '总分', render: (p) => <span className="mono">{formatScore(p.totalScore)}</span> },
    { key: 'usedCount', title: '使用次数', render: (p) => <span className="mono">{p.usedCount ?? 0}</span> },
    {
      key: 'status',
      title: '状态',
      render: (p) => <Tag tone={tagClass(PAPER_STATUS_TAG, p.status).replace('tag-', '')}>{PAPER_STATUS_LABEL[p.status] || p.status}</Tag>,
    },
    {
      key: 'actions',
      title: '',
      render: (p) => (
        <Button size="sm" variant="ghost" onClick={() => openPaper(p)}>
          查看详情
        </Button>
      ),
    },
  ];

  const current = tab === 'exams' ? exams : papers;

  const applyFilter = () => current.setFilters({ keyword, status });
  const reset = () => {
    setKeyword('');
    setStatus('');
    current.resetFilters({ keyword: '', status: '' });
  };

  return (
    <div className="page">
      <PageHeader
        title="考试与试卷监管"
        desc="管理员可查看全量考试与试卷、监控异常答卷与防作弊事件。组卷与发考由教师执行，管理员仅作监管与纠偏。"
      />

      <div className="row gap-2" style={{ marginBottom: 14 }}>
        <button type="button" className={`btn btn-sm ${tab === 'exams' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setTab('exams'); setStatus(''); }}>
          考试监管（{exams.total}）
        </button>
        <button type="button" className={`btn btn-sm ${tab === 'papers' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setTab('papers'); setStatus(''); }}>
          试卷监管（{papers.total}）
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar-item grow">
          <span>关键词</span>
          <Input
            placeholder={tab === 'exams' ? '考试名称 / 编号' : '试卷名称 / 编号'}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
          />
        </div>
        <div className="toolbar-item">
          <span>状态</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {tab === 'exams'
              ? Object.entries(EXAM_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)
              : Object.entries(PAPER_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div className="toolbar-actions">
          <Button variant="primary" size="sm" onClick={applyFilter}>查询</Button>
          <Button variant="ghost" size="sm" onClick={reset}>重置</Button>
        </div>
      </div>

      <div className="list-card">
        <Table
          columns={tab === 'exams' ? examColumns : paperColumns}
          rows={current.list}
          loading={current.loading}
          error={current.error}
          onRetry={current.reload}
          emptyTitle={tab === 'exams' ? '暂无考试记录' : '暂无试卷记录'}
          emptyDesc="教师创建考试与试卷后将在此处出现。"
        />
        <Pagination
          page={current.page}
          pageSize={current.pageSize}
          total={current.total}
          onChange={current.setPage}
          onPageSizeChange={current.setPageSize}
        />
      </div>

      <Modal
        open={Boolean(detail)}
        title={detail?.kind === 'exam' ? '考试监管详情' : '试卷监管详情'}
        onClose={() => setDetail(null)}
        wide
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>关闭</Button>}
      >
        {detail?.loading ? (
          <Loading text="正在加载详情…" />
        ) : detail?.error ? (
          <div className="alert-bar danger">{detail.error}</div>
        ) : detail?.kind === 'exam' && detail.data ? (
          <>
            <div className="detail-grid">
              <div className="detail-item"><span>考试名称</span><b>{detail.data.examName}</b></div>
              <div className="detail-item"><span>考试编号</span><b className="mono">{detail.data.examNo}</b></div>
              <div className="detail-item"><span>关联试卷</span><b>{detail.data.paperName || '—'}</b></div>
              <div className="detail-item"><span>创建教师</span><b>{detail.data.ownerName || '—'}</b></div>
              <div className="detail-item"><span>考试窗口</span><b className="mono xs">{formatDateTime(detail.data.startTime)} ~ {formatDateTime(detail.data.endTime)}</b></div>
              <div className="detail-item"><span>答题时长</span><b>{formatMinutes(detail.data.durationMinutes)}</b></div>
              <div className="detail-item"><span>及格线 / 次数</span><b>{formatScore(detail.data.passScore)} 分 / {detail.data.maxAttempts} 次</b></div>
              <div className="detail-item"><span>参考范围</span><b className="small">班级 {(detail.data.scope?.classIds || []).join('、') || '—'}；学生 {(detail.data.scope?.studentIds || []).length} 人</b></div>
              <div className="detail-item"><span>任务统计</span><b className="mono">应考 {detail.data.taskStats?.total ?? 0} / 作答中 {detail.data.taskStats?.doing ?? 0} / 已交卷 {detail.data.taskStats?.submitted ?? 0} / 缺考 {detail.data.taskStats?.missed ?? 0}</b></div>
              <div className="detail-item"><span>成绩状态</span><b>{SCORE_STATUS_LABEL[detail.data.scoreStatus] || detail.data.scoreStatus}</b></div>
            </div>

            {detail.monitor ? (
              <>
                <hr className="divider" />
                <h3 className="form-section-title">实时监控</h3>
                <div className="metric-grid">
                  <div className="metric"><div className="metric-label">应考人数</div><div className="metric-value">{detail.monitor.totalStudents}</div></div>
                  <div className="metric"><div className="metric-label">作答中</div><div className="metric-value">{detail.monitor.doingCount}</div></div>
                  <div className="metric"><div className="metric-label">已交卷</div><div className="metric-value">{detail.monitor.submittedCount}</div></div>
                  <div className="metric"><div className="metric-label">缺考</div><div className="metric-value">{detail.monitor.missedCount}</div></div>
                  <div className="metric"><div className="metric-label">异常答卷</div><div className="metric-value" style={{ color: 'var(--oe-danger-ink)' }}>{detail.monitor.abnormalCount}</div></div>
                </div>
                {detail.monitor.abnormalAttempts?.length ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>学生</th><th>状态</th><th>已答/总题</th><th>异常原因</th></tr></thead>
                      <tbody>
                        {detail.monitor.abnormalAttempts.map((a) => (
                          <tr key={a.attemptId}>
                            <td>{a.studentName}<div className="xs muted mono">{a.studentNo}</div></td>
                            <td>{a.status}</td>
                            <td className="mono">{a.answeredCount}/{a.questionCount}</td>
                            <td className="small">{a.abnormalReason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="alert-bar info">当前没有异常答卷。</div>
                )}
              </>
            ) : null}
          </>
        ) : detail?.kind === 'paper' && detail.data ? (
          <>
            <div className="detail-grid">
              <div className="detail-item"><span>试卷名称</span><b>{detail.data.paperName}</b></div>
              <div className="detail-item"><span>试卷编号</span><b className="mono">{detail.data.paperNo}</b></div>
              <div className="detail-item"><span>创建教师</span><b>{detail.data.ownerName || '—'}</b></div>
              <div className="detail-item"><span>题数 / 总分</span><b className="mono">{detail.data.questionCount} 题 / {formatScore(detail.data.totalScore)} 分</b></div>
              <div className="detail-item"><span>组卷方式</span><b>{detail.data.assemblyMode === 'random' ? '随机组卷' : '手动组卷'}</b></div>
              <div className="detail-item"><span>状态</span><b>{PAPER_STATUS_LABEL[detail.data.status]}</b></div>
            </div>
            <hr className="divider" />
            <h3 className="form-section-title">题目结构（不含标准答案）</h3>
            {(detail.preview?.questions || detail.data.questions || []).map((q, i) => (
              <div key={q.questionId || i} style={{ padding: '10px 0', borderBottom: '1px dashed var(--oe-core-border)' }}>
                <div className="row-between">
                  <b className="small">{i + 1}. {QUESTION_TYPE_LABEL[q.questionType] || q.questionType}</b>
                  <span className="mono small">{(q.score ?? q.fullScore ?? 0)} 分</span>
                </div>
                <p className="small" style={{ marginTop: 4, lineHeight: 1.7 }}>{q.stem}</p>
              </div>
            ))}
          </>
        ) : null}
      </Modal>
    </div>
  );
}