import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaginated } from '../../hooks/usePaginated.js';
import { listAvailableExams } from '../../api/exams.js';
import { startAttempt } from '../../api/attempts.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Empty from '../../components/Empty.jsx';
import { formatDateTime, formatMinutes, formatScore, getDeviceKey } from '../../utils/format.js';
import { EXAM_STATUS_LABEL, EXAM_STATUS_TAG } from '../../utils/enums.js';

/**
 * 我的考试（REQ-EXM-02/03/04）
 * 契约：GET /exams/available、POST /exams/{id}/attempts
 * 开考流程：考前须知 → 二次确认 → 服务端资格校验 → 创建/恢复答卷 → 进入全屏答题页
 */
export default function StudentExamList() {
  const navigate = useNavigate();
  const exams = usePaginated(listAvailableExams, { pageSize: 10 });

  const [confirm, setConfirm] = useState(null); // { exam, agreed, loading }
  const [error, setError] = useState('');

  const begin = (exam) => {
    setError('');
    setConfirm({ exam, agreed: false, loading: false });
  };

  const startExam = async () => {
    if (!confirm?.agreed) {
      setError('请先阅读并勾选考前须知');
      return;
    }
    setConfirm({ ...confirm, loading: true });
    setError('');
    try {
      const session = await startAttempt(confirm.exam.id, getDeviceKey());
      toast.success('已进入考试，答案将每 3 秒自动暂存');
      navigate(`/student/attempts/${session.attemptId}`, { replace: true });
    } catch (err) {
      setError(err?.displayMessage || '无法开始考试');
      setConfirm({ ...confirm, loading: false });
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="我的考试"
        desc="仅展示分配给本人的考试。进入考试前需核对考试窗口、时长与作答次数；已存在进行中答卷将直接恢复，不重复计时。"
        actions={<Button variant="secondary" size="sm" onClick={exams.reload}>刷新</Button>}
        meta={<Tag tone="cyan">可参加 {exams.total} 场</Tag>}
      />

      {exams.loading ? (
        <Loading text="正在加载可参加考试…" minHeight={320} />
      ) : exams.error ? (
        <ErrorState message={exams.error} onRetry={exams.reload} />
      ) : exams.list.length === 0 ? (
        <Empty title="当前没有可参加的考试" desc="考试发布后会出现在此处，请关注站内通知。" minHeight={320} />
      ) : (
        <div className="col gap-4">
          {exams.list.map((exam) => {
            const ongoing = Boolean(exam.ongoingAttemptId);
            return (
              <div className="card card-pad" key={exam.id}>
                <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row gap-2 row-wrap" style={{ marginBottom: 6 }}>
                      <h2 className="card-title">{exam.examName}</h2>
                      <Tag tone={EXAM_STATUS_TAG[exam.status]?.replace('tag-', '') || 'neutral'}>
                        {EXAM_STATUS_LABEL[exam.status] || exam.status}
                      </Tag>
                      {ongoing ? <Tag tone="green">作答中</Tag> : null}
                      {exam.remainingAttempts === 0 && !ongoing ? <Tag tone="red">次数已用尽</Tag> : null}
                    </div>
                    <div className="xs muted mono">
                      {formatDateTime(exam.startTime)} → {formatDateTime(exam.endTime)}
                    </div>
                    <div className="row gap-4 row-wrap mt-3 small">
                      <span>考试时长：<b>{formatMinutes(exam.durationMinutes)}</b></span>
                      <span>及格线：<b>{formatScore(exam.passScore)}</b></span>
                      <span>可作答：<b>{exam.remainingAttempts ?? 0}</b> 次（共 {exam.attemptsAllowed ?? exam.maxAttempts} 次）</span>
                      {exam.shuffleQuestions ? <span className="pill-note">题目顺序已打乱</span> : null}
                      {exam.antiCheatEnabled ? <span className="pill-note">已启用防作弊采集</span> : null}
                    </div>
                    {exam.description ? <p className="small muted mt-3" style={{ lineHeight: 1.7 }}>{exam.description}</p> : null}
                  </div>

                  <div className="col gap-2" style={{ minWidth: 150 }}>
                    {ongoing ? (
                      <Button variant="primary" onClick={() => navigate(`/student/attempts/${exam.ongoingAttemptId}`)}>
                        继续作答
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        disabled={!exam.canStart}
                        onClick={() => begin(exam)}
                        title={exam.rejectReason || undefined}
                      >
                        进入考试
                      </Button>
                    )}
                    {exam.latestAttemptId ? (
                      <Button variant="secondary" size="sm" onClick={() => navigate(`/student/results/${exam.latestAttemptId}`)}>
                        查看最近成绩
                      </Button>
                    ) : null}
                    {!exam.canStart && exam.rejectReason && !ongoing ? (
                      <span className="xs" style={{ color: 'var(--oe-warning-ink)', maxWidth: 200 }}>{exam.rejectReason}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="list-meta" style={{ border: '1px solid var(--oe-core-border)', borderRadius: 12 }}>
            <span>共 {exams.total} 场可参加考试</span>
            <div className="pager">
              <button type="button" disabled={exams.page <= 1} onClick={() => exams.setPage(exams.page - 1)}>上一页</button>
              <span className="pager-info">{exams.page} / {Math.max(1, Math.ceil(exams.total / exams.pageSize))}</span>
              <button type="button" disabled={exams.page * exams.pageSize >= exams.total} onClick={() => exams.setPage(exams.page + 1)}>下一页</button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(confirm)}
        title={`考前须知 · ${confirm?.exam?.examName || ''}`}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>取消</Button>
            <Button variant="primary" loading={confirm?.loading} onClick={startExam}>确认开考</Button>
          </>
        }
      >
        <div className="detail-grid" style={{ marginBottom: 14 }}>
          <div className="detail-item"><span>考试窗口</span><b className="mono xs">{formatDateTime(confirm?.exam?.startTime)} ~ {formatDateTime(confirm?.exam?.endTime)}</b></div>
          <div className="detail-item"><span>答题时长</span><b>{formatMinutes(confirm?.exam?.durationMinutes)}</b></div>
          <div className="detail-item"><span>及格线</span><b>{formatScore(confirm?.exam?.passScore)} 分</b></div>
          <div className="detail-item"><span>剩余次数</span><b>{confirm?.exam?.remainingAttempts ?? 0} 次</b></div>
        </div>

        <div className="alert-bar" style={{ marginBottom: 12 }}>
          <div>
            <b>作答规则</b>
            <ul style={{ marginTop: 6, lineHeight: 1.9 }}>
              <li>· 计时以服务端时间为准，前端倒计时仅用于展示；</li>
              <li>· 答案每 3 秒自动暂存，切换题目会立即保存；</li>
              <li>· 刷新或断线后重新进入会恢复剩余时间与已保存答案，不重复计时；</li>
              <li>· 剩余时间归零且开启超时自动交卷时，系统将自动交卷；</li>
              <li>· 切屏、复制粘贴、退出全屏等行为将被记录并可能标记答卷异常。</li>
            </ul>
          </div>
        </div>

        {error ? <div className="alert-bar danger">{error}</div> : null}

        <label className="checkbox-line" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={confirm?.agreed || false}
            onChange={(e) => {
              setConfirm({ ...confirm, agreed: e.target.checked });
              setError('');
            }}
          />
          我已阅读考前须知，确认开始作答
        </label>
      </Modal>
    </div>
  );
}