import { useEffect, useState } from 'react';
import { usePaginated } from '../../hooks/usePaginated.js';
import { arbitrateGradingTask, getGradingTask, listGradingTasks } from '../../api/reviews.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Empty from '../../components/Empty.jsx';
import { FormField, Input, Textarea } from '../../components/Form.jsx';
import { formatScore, displayAnswer, formatDateTime } from '../../utils/format.js';
import { QUESTION_TYPE_LABEL } from '../../utils/enums.js';
import { numberRange } from '../../utils/validate.js';

/**
 * 争议仲裁（REQ-MRK-04）
 * 契约：GET /grading-tasks?status=arbitration、GET /grading-tasks/{taskId}、
 *      POST /grading-tasks/{taskId}/arbitrate
 * 触发条件：双评分差超过满分 20% 的任务自动转入 arbitration 状态
 */
export default function AdminArbitration() {
  const queue = usePaginated(listGradingTasks, {
    initialFilters: { status: 'arbitration' },
    pageSize: 20,
  });

  const [taskId, setTaskId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ score: '', reason: '' });
  const [errs, setErrs] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    setLoading(true);
    setError('');
    getGradingTask(taskId)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        setForm({ score: '', reason: '' });
        setErrs({});
      })
      .catch((err) => {
        if (alive) setError(err?.displayMessage || '任务详情加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  const validate = () => {
    const scoreMsg = numberRange(form.score, 0, detail?.fullScore ?? 0, '仲裁得分');
    const nextErrs = {};
    if (scoreMsg) nextErrs.score = scoreMsg;
    if (!form.reason.trim()) nextErrs.reason = '请填写仲裁理由';
    setErrs(nextErrs);
    return Object.keys(nextErrs).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const result = await arbitrateGradingTask(taskId, {
        score: Number(form.score),
        reason: form.reason.trim(),
      });
      toast.success(
        `仲裁完成：最终得分 ${formatScore(result?.finalScore)} / ${detail?.fullScore ?? '—'}`,
      );
      setConfirm(false);
      setTaskId(null);
      setDetail(null);
      queue.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '仲裁提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="争议仲裁"
        desc="双评模式下，两名阅卷教师对同一主观题打分差值超过满分 20% 时自动转入仲裁队列；管理员拥有最终裁定权，裁定结果与三方评分全程留痕。"
        meta={<Tag tone="red">待仲裁 {queue.total}</Tag>}
        actions={<Button variant="secondary" size="sm" onClick={queue.reload}>刷新队列</Button>}
      />

      <div className="grading-layout">
        <div className="card grading-list">
          {queue.loading ? (
            <Loading text="正在加载仲裁队列…" minHeight={180} />
          ) : queue.error ? (
            <ErrorState message={queue.error} onRetry={queue.reload} minHeight={180} />
          ) : queue.list.length === 0 ? (
            <Empty title="暂无待仲裁任务" desc="当双评分差超过阈值时，任务会自动出现在此处。" minHeight={180} />
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
                  <Tag tone="red">待仲裁</Tag>
                </div>
                <div className="gi-meta">
                  {task.examName} · 满分 {formatScore(task.fullScore)}
                </div>
                <div className="gi-meta">
                  一评 {formatScore(task.firstScore)} / 二评 {formatScore(task.secondScore)}
                </div>
              </button>
            ))
          )}
          <div className="list-meta" style={{ borderTop: '1px solid var(--oe-core-border)' }}>
            <span className="xs">共 {queue.total} 条</span>
            <div className="pager">
              <button type="button" disabled={queue.page <= 1} onClick={() => queue.setPage(queue.page - 1)}>上一页</button>
              <button type="button" disabled={queue.page * queue.pageSize >= queue.total} onClick={() => queue.setPage(queue.page + 1)}>下一页</button>
            </div>
          </div>
        </div>

        <div className="card">
          {!taskId ? (
            <Empty title="选择左侧任务开始仲裁" desc="将展示考生答案、参考答案、一二评分数与评语。" minHeight={320} />
          ) : loading ? (
            <Loading text="正在加载答卷详情…" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => setTaskId(taskId)} />
          ) : detail ? (
            <div className="card-pad">
              <div className="row-between" style={{ marginBottom: 14 }}>
                <div>
                  <h2 className="card-title">
                    {detail.studentName}（{detail.studentNo}）
                  </h2>
                  <div className="xs muted">
                    {detail.examName} · {QUESTION_TYPE_LABEL[detail.questionType] || detail.questionType} · 满分 {formatScore(detail.fullScore)}
                  </div>
                </div>
                <Tag tone="violet">仲裁任务 #{detail.taskId}</Tag>
              </div>

              <p className="question-stem">{detail.stem}</p>

              <div className="answer-compare">
                <div className="answer-box">
                  <span className="answer-box-label">考生答案</span>
                  {displayAnswer(detail.studentAnswer)}
                </div>
                <div className="answer-box ref">
                  <span className="answer-box-label">参考答案 / 采分点</span>
                  {detail.questionType === 'short' && !(detail.correctAnswer?.length)
                    ? '主观题 · 按采分点人工评分'
                    : displayAnswer(detail.correctAnswer)}
                  {detail.scoringPoints?.length ? (
                    <ul style={{ marginTop: 8 }}>
                      {detail.scoringPoints.map((sp) => (
                        <li key={sp.point} className="xs">
                          · {sp.point}（{formatScore(sp.score)} 分）
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              <div className="metric-grid">
                <div className="metric">
                  <div className="metric-label">一评得分</div>
                  <div className="metric-value">{formatScore(detail.firstScore)}</div>
                  <div className="metric-foot">{detail.firstComment || '无评语'}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">二评得分</div>
                  <div className="metric-value">{formatScore(detail.secondScore)}</div>
                  <div className="metric-foot">{detail.secondComment || '无评语'}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">分差</div>
                  <div className="metric-value" style={{ color: 'var(--oe-danger-ink)' }}>
                    {detail.firstScore != null && detail.secondScore != null
                      ? formatScore(Math.abs(detail.firstScore - detail.secondScore))
                      : '—'}
                  </div>
                  <div className="metric-foot">满分 20% = {formatScore((detail.fullScore || 0) * 0.2)}</div>
                </div>
              </div>

              <hr className="divider" />
              <h3 className="form-section-title">仲裁裁定</h3>
              <div className="form-grid-2">
                <FormField label={`最终得分（0 ~ ${formatScore(detail.fullScore)}）`} required error={errs.score}>
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
              </div>
              <FormField label="仲裁理由" required error={errs.reason} hint="必填，写入成绩变更记录与审计日志">
                {(f) => (
                  <Textarea
                    id={f.id}
                    rows={3}
                    invalid={Boolean(errs.reason)}
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="如：考生答案覆盖 3 个采分点中的 2 个，一评分数更符合评分细则"
                  />
                )}
              </FormField>
              <div className="form-actions">
                <Button variant="primary" onClick={() => setConfirm(true)}>提交仲裁</Button>
                <Button variant="ghost" onClick={() => setTaskId(null)}>取消选择</Button>
                <span className="xs muted">评分时间：{formatDateTime(detail.createdAt)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        open={confirm}
        title="确认提交仲裁结果"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>再检查一下</Button>
            <Button variant="primary" loading={submitting} onClick={submit}>确认提交</Button>
          </>
        }
      >
        <p style={{ lineHeight: 1.8 }}>
          将把 <b>{detail?.studentName}</b> 该题得分裁定为{' '}
          <b className="mono" style={{ fontSize: 18 }}>{formatScore(form.score)}</b> 分（满分 {formatScore(detail?.fullScore)}），
          并回写答卷总分。
        </p>
        <div className="alert-bar" style={{ marginTop: 12 }}>
          仲裁结果一经提交将记录原值、新值、操作人与理由，不可通过前端撤销。
        </div>
      </Modal>
    </div>
  );
}