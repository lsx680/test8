import { useEffect, useState } from 'react';
import { usePaginated } from '../../hooks/usePaginated.js';
import { getGradingProgress, getGradingTask, listGradingTasks, scoreGradingTask } from '../../api/reviews.js';
import { handleAppeal, listAppeals } from '../../api/stats.js';
import { listExams } from '../../api/exams.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Empty from '../../components/Empty.jsx';
import { FormField, Input, Select, Textarea } from '../../components/Form.jsx';
import { formatDateTime, formatScore, formatPercent, displayAnswer } from '../../utils/format.js';
import {
  QUESTION_TYPE_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_TAG,
  APPEAL_STATUS_LABEL,
  APPEAL_STATUS_TAG,
} from '../../utils/enums.js';
import { numberRange } from '../../utils/validate.js';

/**
 * 阅卷与复核（REQ-MRK-02/03/05/06）
 * 契约：GET /grading-tasks、GET /grading-tasks/{id}、POST /grading-tasks/{id}/score、
 *      GET /exams/{id}/grading-progress、GET /appeals、POST /appeals/{id}/handle
 */
export default function ReviewList() {
  const [tab, setTab] = useState('grading');
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState('');
  const [taskStatus, setTaskStatus] = useState('pending');

  const queue = usePaginated(listGradingTasks, {
    initialFilters: { status: 'pending' },
    pageSize: 20,
  });

  const [taskId, setTaskId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [form, setForm] = useState({ score: '', comment: '', pointScores: {} });
  const [errs, setErrs] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(null);

  // 申诉
  const appeals = usePaginated(listAppeals, { initialFilters: { status: 'pending' }, pageSize: 20 });
  const [appealModal, setAppealModal] = useState(null);
  const [appealForm, setAppealForm] = useState({ status: 'accepted', comment: '', newScore: '' });
  const [appealErrs, setAppealErrs] = useState({});

  useEffect(() => {
    listExams({ page: 1, pageSize: 100 })
      .then((page) => setExams(page?.list || []))
      .catch(() => setExams([]));
  }, []);

  useEffect(() => {
    if (!examId) {
      setProgress(null);
      return;
    }
    getGradingProgress(examId)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [examId]);

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    setDetailLoading(true);
    setDetailError('');
    getGradingTask(taskId)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        setForm({
          score: data.firstScore ?? '',
          comment: data.firstComment || '',
          pointScores: Object.fromEntries((data.scoringPoints || []).map((sp) => [sp.point, ''])),
        });
        setErrs({});
      })
      .catch((err) => {
        if (alive) setDetailError(err?.displayMessage || '阅卷任务加载失败');
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  const applyFilter = () => {
    queue.setFilters({
      ...(examId ? { examId } : {}),
      ...(taskStatus ? { status: taskStatus } : {}),
    });
  };

  const validateScore = () => {
    const full = Number(detail?.fullScore ?? 0);
    const msg = numberRange(form.score, 0, full, '得分');
    const next = {};
    if (msg) next.score = msg;
    const pointSum = Object.values(form.pointScores || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
    const pointFilled = Object.values(form.pointScores || {}).some((v) => v !== '');
    if (pointFilled && Math.abs(pointSum - Number(form.score || 0)) > 0.001) {
      next.pointScores = `采分点合计 ${pointSum} 分，与本题得分 ${form.score} 不一致`;
    }
    setErrs(next);
    return Object.keys(next).length === 0;
  };

  const submitScore = async () => {
    if (!validateScore()) return;
    setSubmitting(true);
    try {
      const pointScores = Object.entries(form.pointScores || {})
        .filter(([, v]) => v !== '')
        .map(([point, v]) => ({ point, score: Number(v) }));
      const result = await scoreGradingTask(taskId, {
        score: Number(form.score),
        ...(form.comment ? { comment: form.comment.trim() } : {}),
        ...(pointScores.length ? { scoringPointScores: pointScores } : {}),
      });
      toast.success(
        `评分已保存：本题 ${formatScore(result?.finalScore)} 分，答卷总分 ${formatScore(result?.totalScore)} 分`,
      );
      setTaskId(null);
      setDetail(null);
      queue.reload();
      if (examId) {
        getGradingProgress(examId).then(setProgress).catch(() => {});
      }
    } catch (err) {
      toast.error(err?.displayMessage || '评分提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const openAppeal = (appeal) => {
    setAppealModal(appeal);
    setAppealForm({ status: 'accepted', comment: '', newScore: appeal.oldScore ?? '' });
    setAppealErrs({});
  };

  const submitAppeal = async () => {
    const next = {};
    if (!appealForm.comment.trim()) next.comment = '请填写复核结论说明';
    if (appealForm.status === 'accepted') {
      const msg = numberRange(appealForm.newScore, 0, 1000, '修正后总分');
      if (msg) next.newScore = msg;
    }
    setAppealErrs(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      await handleAppeal(appealModal.id, {
        status: appealForm.status,
        comment: appealForm.comment.trim(),
        ...(appealForm.status === 'accepted' ? { newScore: Number(appealForm.newScore) } : {}),
      });
      toast.success('复核申诉已处理，成绩变更已留痕');
      setAppealModal(null);
      appeals.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '处理失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="阅卷与复核"
        desc="主观题逐题人工评分，支持按采分点给分与评语；双评分差超过满分 20% 自动转入仲裁。成绩发布后学生可发起复核申诉。"
        meta={
          <>
            <Tag tone="amber">待阅 {queue.total}</Tag>
            <Tag tone="cyan">待处理申诉 {appeals.total}</Tag>
          </>
        }
      />

      <div className="row gap-2" style={{ marginBottom: 14 }}>
        <button type="button" className={`btn btn-sm ${tab === 'grading' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('grading')}>
          主观题阅卷
        </button>
        <button type="button" className={`btn btn-sm ${tab === 'appeals' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('appeals')}>
          成绩复核申诉
        </button>
      </div>

      {tab === 'grading' ? (
        <>
          <div className="toolbar">
            <div className="toolbar-item grow">
              <span>考试</span>
              <Select value={examId} onChange={(e) => setExamId(e.target.value)}>
                <option value="">全部考试</option>
                {exams.map((e) => <option key={e.id} value={e.id}>{e.examName}</option>)}
              </Select>
            </div>
            <div className="toolbar-item">
              <span>任务状态</span>
              <Select value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)}>
                <option value="">全部状态</option>
                {Object.entries(TASK_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div className="toolbar-actions">
              <Button variant="primary" size="sm" onClick={applyFilter}>查询</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setExamId('');
                  setTaskStatus('pending');
                  queue.resetFilters({ status: 'pending' });
                }}
              >
                重置
              </Button>
            </div>
          </div>

          {progress ? (
            <div className="metric-grid">
              <div className="metric"><div className="metric-label">答卷总数</div><div className="metric-value">{progress.totalAttempts}</div></div>
              <div className="metric"><div className="metric-label">已阅答卷</div><div className="metric-value">{progress.gradedAttempts}</div></div>
              <div className="metric"><div className="metric-label">待阅答卷</div><div className="metric-value">{progress.pendingAttempts}</div></div>
              <div className="metric"><div className="metric-label">完成率</div><div className="metric-value">{formatPercent(progress.completionRate ?? 0)}</div></div>
              <div className="metric"><div className="metric-label">待仲裁</div><div className="metric-value" style={{ color: 'var(--oe-danger-ink)' }}>{progress.arbitrationTasks ?? 0}</div></div>
            </div>
          ) : null}

          <div className="grading-layout">
            <div className="card grading-list">
              {queue.loading ? (
                <Loading text="正在加载阅卷队列…" minHeight={180} />
              ) : queue.error ? (
                <ErrorState message={queue.error} onRetry={queue.reload} minHeight={180} />
              ) : queue.list.length === 0 ? (
                <Empty title="没有待阅任务" desc="主观题答卷交卷后会自动进入阅卷队列。" minHeight={180} />
              ) : (
                queue.list.map((task) => (
                  <button
                    key={task.taskId}
                    type="button"
                    className={`grading-item${taskId === task.taskId ? ' active' : ''}`}
                    onClick={() => setTaskId(task.taskId)}
                  >
                    <div className="gi-title">
                      <span>{task.studentName}</span>
                      <Tag tone={TASK_STATUS_TAG[task.status]?.replace('tag-', '') || 'neutral'}>
                        {TASK_STATUS_LABEL[task.status] || task.status}
                      </Tag>
                    </div>
                    <div className="gi-meta">{task.examName} · 满分 {formatScore(task.fullScore)}</div>
                    <div className="gi-meta">
                      {task.studentNo} · 一评 {formatScore(task.firstScore)}
                    </div>
                  </button>
                ))
              )}
              <div className="list-meta">
                <span className="xs">共 {queue.total} 条</span>
                <div className="pager">
                  <button type="button" disabled={queue.page <= 1} onClick={() => queue.setPage(queue.page - 1)}>上一页</button>
                  <button type="button" disabled={queue.page * queue.pageSize >= queue.total} onClick={() => queue.setPage(queue.page + 1)}>下一页</button>
                </div>
              </div>
            </div>

            <div className="card">
              {!taskId ? (
                <Empty title="选择左侧答卷开始阅卷" desc="将并排展示考生答案与参考答案，可填写评语与采分点得分。" minHeight={320} />
              ) : detailLoading ? (
                <Loading text="正在加载答卷…" />
              ) : detailError ? (
                <ErrorState message={detailError} onRetry={() => setTaskId(taskId)} />
              ) : detail ? (
                <div className="card-pad">
                  <div className="row-between" style={{ marginBottom: 14 }}>
                    <div>
                      <h2 className="card-title">{detail.studentName}（{detail.studentNo}）</h2>
                      <div className="xs muted">
                        {detail.examName} · {QUESTION_TYPE_LABEL[detail.questionType] || detail.questionType} · 满分 {formatScore(detail.fullScore)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="xs muted">提交时间</div>
                      <div className="mono xs">{formatDateTime(detail.createdAt)}</div>
                    </div>
                  </div>

                  <p className="question-stem">{detail.stem}</p>
                  {detail.options?.length ? (
                    <div style={{ marginBottom: 14 }}>
                      {detail.options.map((opt) => (
                        <div className="opt-readonly" key={opt.key}>
                          <b>{opt.key}.</b>
                          <span>{opt.content}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="answer-compare">
                    <div className="answer-box">
                      <span className="answer-box-label">考生答案</span>
                      {displayAnswer(detail.studentAnswer)}
                    </div>
                    <div className="answer-box ref">
                      <span className="answer-box-label">参考答案</span>
                      {detail.questionType === 'short' && !(detail.correctAnswer?.length)
                        ? '主观题 · 按采分点人工评分'
                        : displayAnswer(detail.correctAnswer)}
                      {detail.scoringPoints?.length ? (
                        <ul style={{ marginTop: 8 }}>
                          {detail.scoringPoints.map((sp) => (
                            <li key={sp.point} className="xs">· {sp.point}（{formatScore(sp.score)} 分）</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>

                  {(detail.firstScore != null || detail.secondScore != null) ? (
                    <div className="metric-grid">
                      <div className="metric"><div className="metric-label">一评</div><div className="metric-value">{formatScore(detail.firstScore)}</div><div className="metric-foot">{detail.firstComment || '无评语'}</div></div>
                      <div className="metric"><div className="metric-label">二评</div><div className="metric-value">{formatScore(detail.secondScore)}</div><div className="metric-foot">{detail.secondComment || '无评语'}</div></div>
                    </div>
                  ) : null}

                  <hr className="divider" />
                  <h3 className="form-section-title">评分</h3>
                  <div className="form-grid-2">
                    <FormField label={`本题得分（0 ~ ${formatScore(detail.fullScore)}）`} required error={errs.score}>
                      {(f) => (
                        <Input
                          id={f.id}
                          type="number"
                          min="0"
                          max={detail.fullScore}
                          step="0.5"
                          invalid={Boolean(errs.score)}
                          value={form.score}
                          onChange={(e) => setForm({ ...form, score: e.target.value })}
                        />
                      )}
                    </FormField>
                    <div className="score-input-row" style={{ paddingTop: 24 }}>
                      <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, score: detail.fullScore })}>给满分</Button>
                      <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, score: 0 })}>给 0 分</Button>
                    </div>
                  </div>

                  {detail.scoringPoints?.length ? (
                    <FormField label="采分点得分" error={errs.pointScores} hint="可选；填写后合计需与本题得分一致">
                      <div>
                        {detail.scoringPoints.map((sp) => (
                          <div className="scoring-row" key={sp.point}>
                            <span className="small">{sp.point}<span className="xs muted">（{formatScore(sp.score)} 分）</span></span>
                            <Input
                              type="number"
                              min="0"
                              max={sp.score}
                              step="0.5"
                              value={form.pointScores[sp.point] ?? ''}
                              onChange={(e) => setForm({ ...form, pointScores: { ...form.pointScores, [sp.point]: e.target.value } })}
                            />
                            <span />
                          </div>
                        ))}
                      </div>
                    </FormField>
                  ) : null}

                  <FormField label="评语" hint="将展示给学生（成绩详情页）">
                    {(f) => (
                      <Textarea
                        id={f.id}
                        rows={3}
                        value={form.comment}
                        onChange={(e) => setForm({ ...form, comment: e.target.value })}
                        placeholder="如：答案结构完整，但缺少复杂度分析，扣 2 分"
                      />
                    )}
                  </FormField>

                  <div className="form-actions">
                    <Button variant="primary" loading={submitting} onClick={submitScore}>保存评分</Button>
                    <Button variant="ghost" onClick={() => setTaskId(null)}>取消选择</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-item">
              <span>申诉状态</span>
              <Select
                value={appeals.filters.status || ''}
                onChange={(e) => appeals.setFilters({ status: e.target.value })}
              >
                <option value="">全部状态</option>
                {Object.entries(APPEAL_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div className="toolbar-actions">
              <Button variant="secondary" size="sm" onClick={appeals.reload}>刷新</Button>
            </div>
          </div>

          <div className="list-card">
            {appeals.loading ? (
              <Loading text="正在加载申诉工单…" />
            ) : appeals.error ? (
              <ErrorState message={appeals.error} onRetry={appeals.reload} />
            ) : appeals.list.length === 0 ? (
              <Empty title="暂无复核申诉" desc="学生对已发布成绩发起申诉后会出现在此处。" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>申诉单号</th><th>学生</th><th>考试</th><th>申诉理由</th><th>原分 / 新分</th><th>状态</th><th>申诉时间</th><th>操作</th></tr>
                  </thead>
                  <tbody>
                    {appeals.list.map((a) => (
                      <tr key={a.id}>
                        <td className="mono xs">{a.appealNo}</td>
                        <td>{a.studentName}<div className="xs muted mono">{a.studentId}</div></td>
                        <td className="small">{a.examName}</td>
                        <td className="small" style={{ maxWidth: 300 }}>{a.reason}</td>
                        <td className="mono xs">{formatScore(a.oldScore)} / {formatScore(a.newScore)}</td>
                        <td>
                          <Tag tone={APPEAL_STATUS_TAG[a.status]?.replace('tag-', '') || 'neutral'}>
                            {APPEAL_STATUS_LABEL[a.status] || a.status}
                          </Tag>
                        </td>
                        <td className="mono xs">{formatDateTime(a.createdAt)}</td>
                        <td>
                          {a.status === 'pending' ? (
                            <Button size="sm" variant="ghost" onClick={() => openAppeal(a)}>处理</Button>
                          ) : (
                            <span className="xs muted">{a.handlerName || '已处理'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="list-meta">
              <span>共 {appeals.total} 条</span>
              <div className="pager">
                <button type="button" disabled={appeals.page <= 1} onClick={() => appeals.setPage(appeals.page - 1)}>上一页</button>
                <button type="button" disabled={appeals.page * appeals.pageSize >= appeals.total} onClick={() => appeals.setPage(appeals.page + 1)}>下一页</button>
              </div>
            </div>
          </div>
        </>
      )}

      <Modal
        open={Boolean(appealModal)}
        title={`处理复核申诉 · ${appealModal?.appealNo || ''}`}
        onClose={() => setAppealModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAppealModal(null)}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={submitAppeal}>提交处理结果</Button>
          </>
        }
      >
        <p className="small" style={{ lineHeight: 1.8, marginBottom: 12 }}>
          {appealModal?.studentName} 对「{appealModal?.examName}」提出复核：{appealModal?.reason}
        </p>
        <FormField label="处理结论" required>
          {(f) => (
            <Select id={f.id} value={appealForm.status} onChange={(e) => setAppealForm({ ...appealForm, status: e.target.value })}>
              <option value="accepted">采纳申诉（调整成绩）</option>
              <option value="rejected">驳回申诉</option>
              <option value="closed">关闭工单</option>
            </Select>
          )}
        </FormField>
        {appealForm.status === 'accepted' ? (
          <FormField label="修正后总分" required error={appealErrs.newScore} hint={`原分 ${formatScore(appealModal?.oldScore)}`}>
            {(f) => (
              <Input
                id={f.id}
                type="number"
                min="0"
                step="0.5"
                invalid={Boolean(appealErrs.newScore)}
                value={appealForm.newScore}
                onChange={(e) => setAppealForm({ ...appealForm, newScore: e.target.value })}
              />
            )}
          </FormField>
        ) : null}
        <FormField label="处理说明" required error={appealErrs.comment} hint="写入成绩变更记录，学生可见">
          {(f) => (
            <Textarea
              id={f.id}
              rows={3}
              invalid={Boolean(appealErrs.comment)}
              value={appealForm.comment}
              onChange={(e) => setAppealForm({ ...appealForm, comment: e.target.value })}
            />
          )}
        </FormField>
      </Modal>
    </div>
  );
}