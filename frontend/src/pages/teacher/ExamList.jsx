import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaginated } from '../../hooks/usePaginated.js';
import {
  getExamMonitor,
  grantExtraAttempts,
  listAntiCheatEvents,
  listExamTasks,
  listExams,
  publishExam,
  updateExamStatus,
} from '../../api/exams.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Pagination from '../../components/Pagination.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import { FormField, Input, Select, Textarea } from '../../components/Form.jsx';
import { formatDateTime, formatMinutes, formatScore, formatPercent } from '../../utils/format.js';
import {
  EXAM_STATUS_LABEL,
  EXAM_STATUS_TAG,
  SCORE_STATUS_LABEL,
  EXAM_TASK_STATUS_LABEL,
  EXAM_TASK_STATUS_TAG,
  ANTI_CHEAT_TYPE_LABEL,
} from '../../utils/enums.js';
import { integerRange, maxLen, required, runRules } from '../../utils/validate.js';

/**
 * 考试管理（REQ-EXM-01/02/09/10）
 * 契约：GET/POST /exams、GET /exams/{id}/monitor、GET /exams/{id}/anti-cheat-events、
 *      GET /exams/{id}/tasks、POST /exams/{id}/publish、PATCH /exams/{id}/status、
 *      POST /exams/{id}/grants
 * 契约缺口：补考授权需 studentIds，但教师无可用学生名单查询端点（GET /users 仅管理员），
 *          故此处支持手工输入学生 ID，并在界面提示。
 */
export default function ExamList() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [scoreStatus, setScoreStatus] = useState('');
  const exams = usePaginated(listExams, { initialFilters: { keyword: '', status: '', scoreStatus: '' } });

  const [monitor, setMonitor] = useState(null); // { exam, data, events, loading, error }
  const [tasks, setTasks] = useState(null); // { exam, data, loading, error, status }
  const [grant, setGrant] = useState(null); // { exam, form, errs }
  const [statusModal, setStatusModal] = useState(null); // { exam, form }
  const [busy, setBusy] = useState(false);

  const openMonitor = async (exam) => {
    setMonitor({ exam, data: null, events: [], loading: true, error: '' });
    try {
      const [data, events] = await Promise.all([
        getExamMonitor(exam.id),
        listAntiCheatEvents(exam.id, { page: 1, pageSize: 10 }).catch(() => ({ list: [] })),
      ]);
      setMonitor({ exam, data, events: events?.list || [], loading: false, error: '' });
    } catch (err) {
      setMonitor({ exam, data: null, events: [], loading: false, error: err?.displayMessage || '监控数据加载失败' });
    }
  };

  const openTasks = async (exam, taskStatus = '') => {
    setTasks({ exam, data: null, loading: true, error: '', status: taskStatus });
    try {
      const data = await listExamTasks(exam.id, { page: 1, pageSize: 50, ...(taskStatus ? { status: taskStatus } : {}) });
      setTasks({ exam, data, loading: false, error: '', status: taskStatus });
    } catch (err) {
      setTasks({ exam, data: null, loading: false, error: err?.displayMessage || '考试任务加载失败', status: taskStatus });
    }
  };

  const doPublish = async (exam) => {
    if (!window.confirm(`确认发布考试「${exam.examName}」？发布后将生成考试任务并通知参考学生。`)) return;
    setBusy(true);
    try {
      const result = await publishExam(exam.id);
      toast.success(`发布成功：生成 ${result?.taskCount ?? 0} 条考试任务，通知 ${result?.notifiedCount ?? 0} 人`);
      exams.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const submitGrant = async () => {
    const result = runRules(grant.form, {
      studentIds: [(v) => required(v, '学生 ID')],
      extraAttempts: [(v) => integerRange(v, 1, 3, '增加次数')],
      reason: [(v) => required(v, '授权原因'), (v) => maxLen(v, 255, '授权原因')],
    });
    if (!Object.keys(result.errors).length) {
      const ids = String(grant.form.studentIds)
        .split(/[,，\s]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) result.errors.studentIds = '请输入至少一个有效的学生 ID';
    }
    setGrant({ ...grant, errs: result.errors });
    if (Object.keys(result.errors).length) return;

    setBusy(true);
    try {
      const ids = String(grant.form.studentIds).split(/[,，\s]+/).filter(Boolean).map(Number);
      await grantExtraAttempts(grant.exam.id, {
        studentIds: ids,
        extraAttempts: Number(grant.form.extraAttempts),
        reason: grant.form.reason.trim(),
      });
      toast.success(`已为 ${ids.length} 名学生增加 ${grant.form.extraAttempts} 次作答机会`);
      setGrant(null);
      exams.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '补考授权失败');
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = async () => {
    setBusy(true);
    try {
      await updateExamStatus(statusModal.exam.id, {
        status: statusModal.form.status,
        ...(statusModal.form.endTime ? { endTime: statusModal.form.endTime } : {}),
        ...(statusModal.form.reason ? { reason: statusModal.form.reason } : {}),
        notifyStudents: statusModal.form.notifyStudents,
      });
      toast.success('考试状态已更新，相关学生已收到通知（如勾选）');
      setStatusModal(null);
      exams.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '状态变更失败');
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'exam',
      title: '考试',
      render: (e) => (
        <div>
          <div className="strong">{e.examName}</div>
          <div className="xs muted mono">{e.examNo} · {e.paperName}</div>
        </div>
      ),
    },
    {
      key: 'window',
      title: '考试窗口',
      render: (e) => (
        <div className="xs mono">
          <div>{formatDateTime(e.startTime)}</div>
          <div className="muted">→ {formatDateTime(e.endTime)}</div>
        </div>
      ),
    },
    { key: 'durationMinutes', title: '时长', render: (e) => formatMinutes(e.durationMinutes) },
    { key: 'passScore', title: '及格线', render: (e) => <span className="mono">{formatScore(e.passScore)}</span> },
    { key: 'maxAttempts', title: '次数', render: (e) => <span className="mono">{e.maxAttempts}</span> },
    {
      key: 'status',
      title: '状态',
      render: (e) => (
        <Tag tone={EXAM_STATUS_TAG[e.status]?.replace('tag-', '') || 'neutral'}>
          {EXAM_STATUS_LABEL[e.status] || e.status}
        </Tag>
      ),
    },
    {
      key: 'scoreStatus',
      title: '成绩',
      render: (e) => (
        <Tag tone={e.scoreStatus === 'published' ? 'green' : 'amber'}>
          {SCORE_STATUS_LABEL[e.scoreStatus] || e.scoreStatus}
        </Tag>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      render: (e) => (
        <div className="cell-actions">
          <Button size="sm" variant="ghost" onClick={() => openMonitor(e)}>监控</Button>
          <Button size="sm" variant="ghost" onClick={() => openTasks(e)}>考生</Button>
          {e.status === 'draft' ? (
            <Button size="sm" variant="ghost" loading={busy} onClick={() => doPublish(e)}>发布</Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={e.status === 'archived' || e.status === 'cancelled'}
            onClick={() => setStatusModal({
              exam: e,
              form: { status: 'cancelled', endTime: '', reason: '', notifyStudents: true },
            })}
          >
            变更
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/teacher/exams/${e.id}/edit`)}>编辑</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/teacher/stats?examId=${e.id}`)}>统计</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setGrant({
              exam: e,
              form: { studentIds: '', extraAttempts: 1, reason: '' },
              errs: {},
            })}
          >
            补考授权
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="考试管理"
        desc="创建考试草稿、发布考试、监控作答与异常行为、变更考试状态并为指定学生增加作答次数。答题时长不得超过考试窗口长度。"
        actions={<Button variant="primary" onClick={() => navigate('/teacher/exams/new')}>+ 创建考试</Button>}
      />

      <div className="toolbar">
        <div className="toolbar-item grow">
          <span>关键词</span>
          <Input
            placeholder="考试名称 / 编号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && exams.setFilters({ keyword, status, scoreStatus })}
          />
        </div>
        <div className="toolbar-item">
          <span>状态</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(EXAM_STATUS_LABEL).filter(([v]) => v !== 'archived').map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div className="toolbar-item">
          <span>成绩状态</span>
          <Select value={scoreStatus} onChange={(e) => setScoreStatus(e.target.value)}>
            <option value="">全部</option>
            <option value="unpublished">评阅中</option>
            <option value="published">已发布</option>
          </Select>
        </div>
        <div className="toolbar-actions">
          <Button variant="primary" size="sm" onClick={() => exams.setFilters({ keyword, status, scoreStatus })}>查询</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKeyword('');
              setStatus('');
              setScoreStatus('');
              exams.resetFilters({ keyword: '', status: '', scoreStatus: '' });
            }}
          >
            重置
          </Button>
        </div>
      </div>

      <div className="list-card">
        <Table
          columns={columns}
          rows={exams.list}
          loading={exams.loading}
          error={exams.error}
          onRetry={exams.reload}
          emptyTitle="暂无考试"
          emptyDesc="先创建试卷，再基于试卷创建考试。"
        />
        <Pagination page={exams.page} pageSize={exams.pageSize} total={exams.total} onChange={exams.setPage} onPageSizeChange={exams.setPageSize} />
      </div>

      {/* 监控看板 */}
      <Modal
        open={Boolean(monitor)}
        title={`考试监控 · ${monitor?.exam?.examName || ''}`}
        onClose={() => setMonitor(null)}
        wide
        footer={<Button variant="secondary" onClick={() => setMonitor(null)}>关闭</Button>}
      >
        {monitor?.loading ? (
          <Loading text="正在加载监控数据…" />
        ) : monitor?.error ? (
          <ErrorState message={monitor.error} onRetry={() => openMonitor(monitor.exam)} />
        ) : monitor?.data ? (
          <>
            <div className="metric-grid">
              <div className="metric"><div className="metric-label">应考</div><div className="metric-value">{monitor.data.totalStudents}</div></div>
              <div className="metric"><div className="metric-label">作答中</div><div className="metric-value">{monitor.data.doingCount}</div></div>
              <div className="metric"><div className="metric-label">已交卷</div><div className="metric-value">{monitor.data.submittedCount}</div></div>
              <div className="metric"><div className="metric-label">缺考</div><div className="metric-value">{monitor.data.missedCount}</div></div>
              <div className="metric"><div className="metric-label">异常答卷</div><div className="metric-value" style={{ color: 'var(--oe-danger-ink)' }}>{monitor.data.abnormalCount}</div></div>
              <div className="metric"><div className="metric-label">在线率</div><div className="metric-value">{formatPercent(monitor.data.onlineRate ?? 0)}</div></div>
            </div>
            <div className="xs muted" style={{ marginBottom: 12 }}>服务端时间：{formatDateTime(monitor.data.serverTime)}</div>

            <h3 className="form-section-title">异常答卷</h3>
            {monitor.data.abnormalAttempts?.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>学生</th><th>状态</th><th>已答/总题</th><th>异常原因</th><th>截止时间</th></tr></thead>
                  <tbody>
                    {monitor.data.abnormalAttempts.map((a) => (
                      <tr key={a.attemptId}>
                        <td>{a.studentName}<div className="xs muted mono">{a.studentNo}</div></td>
                        <td>{a.status}</td>
                        <td className="mono">{a.answeredCount}/{a.questionCount}</td>
                        <td className="small">{a.abnormalReason || '—'}</td>
                        <td className="mono xs">{formatDateTime(a.deadlineAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="alert-bar info">当前没有异常答卷。</div>}

            <h3 className="form-section-title" style={{ marginTop: 18 }}>最近防作弊事件</h3>
            {monitor.events.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>学生</th><th>事件</th><th>累计次数</th><th>时间</th></tr></thead>
                  <tbody>
                    {monitor.events.map((ev) => (
                      <tr key={ev.id}>
                        <td>{ev.studentName || '—'}</td>
                        <td><Tag tone="amber">{ANTI_CHEAT_TYPE_LABEL[ev.eventType] || ev.eventType}</Tag></td>
                        <td className="mono">{ev.cumulativeCount}</td>
                        <td className="mono xs">{formatDateTime(ev.eventTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="xs muted">暂无防作弊事件记录。</div>}
          </>
        ) : null}
      </Modal>

      {/* 考生任务 */}
      <Modal
        open={Boolean(tasks)}
        title={`考生任务 · ${tasks?.exam?.examName || ''}`}
        onClose={() => setTasks(null)}
        wide
        footer={<Button variant="secondary" onClick={() => setTasks(null)}>关闭</Button>}
      >
        <div className="row gap-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          {[['', '全部'], ['pending', '待作答'], ['doing', '作答中'], ['submitted', '已交卷'], ['missed', '缺考']].map(([v, l]) => (
            <button
              key={v || 'all'}
              type="button"
              className={`btn btn-sm ${tasks?.status === v ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => openTasks(tasks.exam, v)}
            >
              {l}
            </button>
          ))}
        </div>
        {tasks?.loading ? (
          <Loading text="正在加载考生任务…" />
        ) : tasks?.error ? (
          <ErrorState message={tasks.error} onRetry={() => openTasks(tasks.exam, tasks.status)} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>状态</th><th>次数（已用/可用）</th><th>通知时间</th></tr></thead>
              <tbody>
                {(tasks?.data?.list || []).map((t) => (
                  <tr key={t.taskId}>
                    <td className="mono">{t.studentNo}</td>
                    <td>{t.studentName}</td>
                    <td>{t.className || '—'}</td>
                    <td>
                      <Tag tone={EXAM_TASK_STATUS_TAG[t.status]?.replace('tag-', '') || 'neutral'}>
                        {EXAM_TASK_STATUS_LABEL[t.status] || t.status}
                      </Tag>
                    </td>
                    <td className="mono">{t.attemptsUsed}/{t.attemptsAllowed}</td>
                    <td className="mono xs">{formatDateTime(t.notifiedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(tasks?.data?.list || []).length === 0 ? <div className="dash-empty">该状态下暂无考生任务。</div> : null}
          </div>
        )}
      </Modal>

      {/* 补考授权 */}
      <Modal
        open={Boolean(grant)}
        title={`补考授权 · ${grant?.exam?.examName || ''}`}
        onClose={() => setGrant(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGrant(null)}>取消</Button>
            <Button variant="primary" loading={busy} onClick={submitGrant}>确认授权</Button>
          </>
        }
      >
        <FormField label="学生 ID" required error={grant?.errs?.studentIds} hint="多个 ID 用逗号分隔；当前契约未向教师提供学生名单查询接口">
          {(f) => (
            <Input
              id={f.id}
              invalid={f.invalid}
              value={grant?.form?.studentIds || ''}
              onChange={(e) => setGrant({ ...grant, form: { ...grant.form, studentIds: e.target.value } })}
              placeholder="如：1024, 1025"
            />
          )}
        </FormField>
        <FormField label="增加作答次数" required error={grant?.errs?.extraAttempts}>
          {(f) => (
            <Input
              id={f.id}
              type="number"
              min="1"
              max="3"
              invalid={f.invalid}
              value={grant?.form?.extraAttempts ?? 1}
              onChange={(e) => setGrant({ ...grant, form: { ...grant.form, extraAttempts: e.target.value } })}
            />
          )}
        </FormField>
        <FormField label="授权原因" required error={grant?.errs?.reason} hint="写入审计日志">
          {(f) => (
            <Textarea
              id={f.id}
              rows={2}
              invalid={f.invalid}
              value={grant?.form?.reason || ''}
              onChange={(e) => setGrant({ ...grant, form: { ...grant.form, reason: e.target.value } })}
              placeholder="如：学生因网络中断未能完成答题"
            />
          )}
        </FormField>
        <div className="alert-bar">
          学生增加作答次数后仍受考试窗口约束；已交卷记录不会被删除。
        </div>
      </Modal>

      {/* 状态变更 */}
      <Modal
        open={Boolean(statusModal)}
        title={`考试状态变更 · ${statusModal?.exam?.examName || ''}`}
        onClose={() => setStatusModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusModal(null)}>取消</Button>
            <Button variant="primary" loading={busy} onClick={submitStatus}>提交变更</Button>
          </>
        }
      >
        <FormField label="目标状态" required>
          {(f) => (
            <Select
              id={f.id}
              value={statusModal?.form?.status}
              onChange={(e) => setStatusModal({ ...statusModal, form: { ...statusModal.form, status: e.target.value } })}
            >
              <option value="cancelled">取消考试（可延期：填写新结束时间）</option>
              <option value="finished">提前结束</option>

            </Select>
          )}
        </FormField>
        <FormField label="新结束时间" hint="取消/延期时填写；留空表示不调整">
          {(f) => (
            <Input
              id={f.id}
              type="datetime-local"
              value={statusModal?.form?.endTime || ''}
              onChange={(e) => setStatusModal({ ...statusModal, form: { ...statusModal.form, endTime: e.target.value } })}
            />
          )}
        </FormField>
        <FormField label="变更原因">
          {(f) => (
            <Textarea
              id={f.id}
              rows={2}
              value={statusModal?.form?.reason || ''}
              onChange={(e) => setStatusModal({ ...statusModal, form: { ...statusModal.form, reason: e.target.value } })}
            />
          )}
        </FormField>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={statusModal?.form?.notifyStudents ?? true}
            onChange={(e) => setStatusModal({ ...statusModal, form: { ...statusModal.form, notifyStudents: e.target.checked } })}
          />
          向受影响学生推送站内通知
        </label>
      </Modal>
    </div>
  );
}