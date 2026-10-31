import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch.js';
import { createAppeal, getMyGradeDetail } from '../../api/stats.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import { FormField, Select, Textarea } from '../../components/Form.jsx';
import { formatDateTime, formatScore, displayAnswer } from '../../utils/format.js';
import { QUESTION_TYPE_LABEL, SCORE_STATUS_LABEL } from '../../utils/enums.js';

/**
 * 成绩详情（REQ-STA-01、REQ-MRK-05）
 * 契约：GET /my/grades/{attemptId}（仅成绩已发布且为本人才返回具体分数）
 *      POST /appeals（选择题目并填写理由，申诉期内可发起）
 */
export default function ResultDetail() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const grade = useFetch(() => getMyGradeDetail(attemptId), [attemptId]);

  const [appealOpen, setAppealOpen] = useState(false);
  const [form, setForm] = useState({ questionId: '', reason: '' });
  const [errs, setErrs] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const submitAppeal = async () => {
    const next = {};
    if (!form.reason.trim()) next.reason = '请填写申诉理由，说明你认为评分存在问题的依据';
    else if (form.reason.trim().length > 1000) next.reason = '申诉理由不能超过 1000 个字符';
    setErrs(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      await createAppeal({
        examId: grade.data.examId,
        ...(form.questionId ? { questionId: Number(form.questionId) } : {}),
        reason: form.reason.trim(),
      });
      toast.success('复核申诉已提交，教师处理后将通知你');
      setAppealOpen(false);
      setForm({ questionId: '', reason: '' });
    } catch (err) {
      toast.error(err?.displayMessage || '申诉提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (grade.loading) {
    return <div className="page"><Loading text="正在加载成绩详情…" minHeight={360} /></div>;
  }

  if (grade.error) {
    return (
      <div className="page">
        <ErrorState
          title="成绩详情不可用"
          message={`${grade.error}（成绩未发布或答卷不属于当前账号时无法查看）`}
          onRetry={() => grade.reload()}
        />
        <div className="text-center mt-4">
          <Button variant="secondary" onClick={() => navigate('/student/results')}>返回我的成绩</Button>
        </div>
      </div>
    );
  }

  const data = grade.data;
  if (!data) return null;

  const published = data.scoreStatus === 'published';

  return (
    <div className="page">
      <PageHeader
        title={data.examName}
        desc={`答卷 #${data.attemptId} · 交卷时间 ${formatDateTime(data.submittedAt)} · 成绩状态 ${SCORE_STATUS_LABEL[data.scoreStatus] || data.scoreStatus}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/student/results')}>返回列表</Button>
            <Button variant="secondary" onClick={() => window.print()}>打印成绩单</Button>
            <Button variant="primary" onClick={() => setAppealOpen(true)} disabled={!published}>
              发起复核申诉
            </Button>
          </>
        }
        meta={
          <>
            <Tag tone={published ? 'green' : 'amber'}>{SCORE_STATUS_LABEL[data.scoreStatus]}</Tag>
            {data.isPassed === null || data.isPassed === undefined ? (
              <Tag tone="neutral">待判定</Tag>
            ) : data.isPassed ? (
              <Tag tone="green">及格</Tag>
            ) : (
              <Tag tone="red">不及格</Tag>
            )}
            {data.rankRange ? <Tag tone="violet">班级排名 {data.rankRange}</Tag> : null}
          </>
        }
      />

      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">总分</div>
          <div className="metric-value">{formatScore(data.totalScore)}</div>
          <div className="metric-foot">及格线 {formatScore(data.passScore)} 分</div>
        </div>
        <div className="metric">
          <div className="metric-label">客观题</div>
          <div className="metric-value">{formatScore(data.objectiveScore)}</div>
          <div className="metric-foot">自动判分</div>
        </div>
        <div className="metric">
          <div className="metric-label">主观题</div>
          <div className="metric-value">{formatScore(data.subjectiveScore)}</div>
          <div className="metric-foot">人工阅卷</div>
        </div>
        <div className="metric">
          <div className="metric-label">班级排名</div>
          <div className="metric-value" style={{ fontSize: 20 }}>{data.classRank ? `第 ${data.classRank} 名` : '—'}</div>
          <div className="metric-foot">{data.rankRange || '排名区间未提供'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">逐题得分</span>
          <span className="xs muted">共 {data.questions?.length || 0} 题</span>
        </div>
        <div className="card-pad">
          {!data.questions?.length ? (
            <p className="small muted">暂无题目明细。</p>
          ) : (
            data.questions.map((q, index) => (
              <div className="result-question" key={q.questionId || index}>
                <div className="rq-head">
                  <div className="row gap-2 row-wrap">
                    <b className="mono">第 {index + 1} 题</b>
                    <Tag tone="neutral">{QUESTION_TYPE_LABEL[q.questionType] || q.questionType}</Tag>
                    {q.questionType === 'short' ? (
                      // 主观题没有唯一对错，展示人工评分标识
                      <Tag tone="violet">人工评分</Tag>
                    ) : q.isCorrect === true ? (
                      <Tag tone="green">正确</Tag>
                    ) : q.isCorrect === false ? (
                      <Tag tone="red">错误</Tag>
                    ) : null}
                  </div>
                  <span className="rq-score">
                    {formatScore(q.finalScore)} / {formatScore(q.fullScore)} 分
                  </span>
                </div>

                <p className="rq-stem">{q.stem}</p>

                {q.options?.length ? (
                  <div style={{ marginBottom: 10 }}>
                    {q.options.map((opt) => {
                      const isCorrect = q.correctAnswer?.includes(opt.key);
                      return (
                        <div className={`opt-readonly${isCorrect ? ' correct' : ''}`} key={opt.key}>
                          <b>{opt.key}.</b>
                          <span>{opt.content}{isCorrect ? ' ✓' : ''}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="rq-answers">
                  <div>
                    <span className="label">我的答案</span>
                    {displayAnswer(q.studentAnswer)}
                  </div>
                  <div>
                    <span className="label">标准答案</span>
                    {q.questionType === 'short' && !(q.correctAnswer?.length)
                      ? '主观题 · 按采分点人工评分'
                      : displayAnswer(q.correctAnswer)}
                  </div>
                </div>

                <div className="row gap-3 mt-2 xs muted">
                  <span>自动判分：{formatScore(q.autoScore)}</span>
                  <span>人工评分：{formatScore(q.manualScore)}</span>
                </div>

                {q.graderComment ? <div className="rq-comment">教师评语：{q.graderComment}</div> : null}
                {q.analysis ? (
                  <div className="alert-bar info" style={{ marginTop: 8 }}>
                    <div><b>解析：</b>{q.analysis}</div>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        open={appealOpen}
        title="发起成绩复核申诉"
        onClose={() => setAppealOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAppealOpen(false)}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={submitAppeal}>提交申诉</Button>
          </>
        }
      >
        <div className="alert-bar info" style={{ marginBottom: 14 }}>
          申诉须在成绩发布后的申诉期内提交（时限由系统参数配置，默认 7 天）。复核结论会回写成绩并保留修改前后值。
        </div>
        <FormField label="申诉题目" hint="不选择表示对整卷成绩提出申诉">
          {(f) => (
            <Select id={f.id} value={form.questionId} onChange={(e) => setForm({ ...form, questionId: e.target.value })}>
              <option value="">整卷申诉</option>
              {(data.questions || []).map((q, index) => (
                <option key={q.questionId} value={q.questionId}>
                  第 {index + 1} 题（{formatScore(q.finalScore)} / {formatScore(q.fullScore)} 分）
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="申诉理由" required error={errs.reason} hint="请具体说明答案与评分细则的偏差，最多 1000 字">
          {(f) => (
            <Textarea
              id={f.id}
              rows={5}
              invalid={Boolean(errs.reason)}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="如：第 3 题答案已覆盖采分点中的「时间复杂度分析」，但该采分点未给分"
            />
          )}
        </FormField>
      </Modal>
    </div>
  );
}