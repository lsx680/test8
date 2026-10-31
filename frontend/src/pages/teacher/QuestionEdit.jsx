import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createQuestion, getQuestion, listQuestionBanks, listQuestionVersions, updateQuestion } from '../../api/questions.js';
import { listKnowledgePoints } from '../../api/knowledge.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import QuestionEditor, { emptyQuestion } from '../../components/QuestionEditor.jsx';
import Tag from '../../components/Tag.jsx';
import { formatDateTime } from '../../utils/format.js';
import { QUESTION_TYPE_LABEL } from '../../utils/enums.js';
import { numberRange } from '../../utils/validate.js';

/**
 * 题目新增 / 编辑（REQ-QBM-01 / 02）
 * 契约：POST /questions、GET|PUT /questions/{questionId}、GET /questions/{id}/versions
 * 编辑时携带 version 作为乐观锁；不一致服务端返回 409，需重新加载后再改。
 */
export default function QuestionEdit() {
  const { questionId } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(questionId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banks, setBanks] = useState([]);
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [value, setValue] = useState(emptyQuestion());
  const [errs, setErrs] = useState({});
  const [versions, setVersions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const tasks = [listQuestionBanks({ page: 1, pageSize: 100 }), listKnowledgePoints({})];
    if (isEdit) tasks.push(getQuestion(questionId), listQuestionVersions(questionId).catch(() => []));
    Promise.all(tasks)
      .then(([bankPage, kpList, question, versionList]) => {
        if (!alive) return;
        setBanks(bankPage?.list || bankPage || []);
        setKnowledgePoints(kpList || []);
        if (question) {
          setOrigin(question);
          setValue({
            bankId: question.bankId,
            knowledgePointId: question.knowledgePointId ?? '',
            questionType: question.questionType,
            difficulty: question.difficulty ?? 3,
            stem: question.stem || '',
            options: question.options?.length ? question.options : undefined,
            correctAnswer: question.correctAnswer || [],
            scoringPoints: question.scoringPoints || [],
            analysis: question.analysis || '',
            defaultScore: question.defaultScore ?? 2,
            status: question.status === 'draft' ? 'draft' : 'published',
            version: question.currentVersion,
          });
          setVersions(versionList || []);
        }
      })
      .catch((err) => {
        if (alive) setError(err?.displayMessage || '题目加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [questionId, isEdit]);

  const validate = () => {
    const next = {};
    if (!value.bankId) next.bankId = '请选择所属题库';
    if (!value.stem?.trim()) next.stem = '题干不能为空';
    const scoreMsg = numberRange(value.defaultScore, 0.5, 100, '默认分值');
    if (scoreMsg) next.defaultScore = scoreMsg;

    const type = value.questionType;
    if (type === 'single' || type === 'multiple') {
      const options = value.options || [];
      if (options.length < 2) next.options = '选项至少需要 2 项';
      else if (options.some((o) => !String(o.content || '').trim())) next.options = '每个选项的内容都不能为空';
      else if (new Set(options.map((o) => o.key)).size !== options.length) next.options = '选项标识不能重复';
      if (type === 'single' && value.correctAnswer?.length !== 1) next.correctAnswer = '单选题必须且仅有一个正确选项';
      if (type === 'multiple' && !value.correctAnswer?.length) next.correctAnswer = '多选题答案集合不能为空';
      if (value.correctAnswer?.some((k) => !options.some((o) => o.key === k))) {
        next.correctAnswer = '标准答案必须来自当前选项';
      }
    }
    if (type === 'judge' && !['true', 'false'].includes(value.correctAnswer?.[0])) {
      next.correctAnswer = '请选择判断答案（正确 / 错误）';
    }
    if (type === 'fill') {
      if (!value.correctAnswer?.length) next.correctAnswer = '填空题答案不能为空';
      else if (value.correctAnswer.some((a) => !String(a || '').trim())) next.correctAnswer = '每个空的答案都不能为空';
    }
    if (type === 'short') {
      const points = (value.scoringPoints || []).filter((p) => p.point?.trim() || p.score !== '');
      if (!points.length) next.scoringPoints = '简答题需至少一个采分点';
      else if (points.some((p) => !p.point?.trim() || p.score === '' || Number.isNaN(Number(p.score)))) {
        next.scoringPoints = '采分点描述与分值均不能为空';
      } else {
        const sum = points.reduce((acc, p) => acc + Number(p.score), 0);
        if (sum > Number(value.defaultScore)) next.scoringPoints = `采分点分值之和（${sum}）超过题目满分（${value.defaultScore}）`;
      }
    }
    setErrs(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) {
      toast.warning('请先修正表单中的校验错误');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bankId: Number(value.bankId),
        questionType: value.questionType,
        difficulty: Number(value.difficulty) || 3,
        stem: value.stem.trim(),
        correctAnswer: value.correctAnswer || [],
        defaultScore: Number(value.defaultScore),
        status: value.status,
        ...(value.knowledgePointId !== '' ? { knowledgePointId: Number(value.knowledgePointId) } : {}),
        ...(value.options?.length ? { options: value.options.map((o) => ({ key: o.key, content: o.content })) } : {}),
        ...(value.scoringPoints?.length
          ? { scoringPoints: value.scoringPoints.map((p) => ({ point: p.point, score: Number(p.score) })) }
          : {}),
        ...(value.analysis ? { analysis: value.analysis } : {}),
      };

      if (isEdit) {
        const result = await updateQuestion(questionId, { ...payload, version: origin?.currentVersion });
        toast.success(`题目已更新，当前版本 v${result?.version ?? ''}`);
      } else {
        await createQuestion(payload);
        toast.success('题目已创建');
      }
      navigate('/teacher/questions');
    } catch (err) {
      if (err?.errors?.length) {
        const mapped = {};
        err.errors.forEach((e) => {
          if (e?.field) mapped[e.field] = e.message;
        });
        setErrs(mapped);
      }
      if (err?.status === 409) {
        toast.error('题目已被他人修改（版本冲突），请刷新后重新编辑');
      } else {
        toast.error(err?.displayMessage || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <Loading text="正在加载题目…" minHeight={320} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={isEdit ? '编辑题目' : '新建题目'}
        desc={
          isEdit
            ? '修改题目会生成一条版本记录；已开始考试中的题目快照不受影响，保证历史数据可追溯。'
            : '按题型填写题干、选项与标准答案；保存后自动生成第 1 版快照。'
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/teacher/questions')}>返回列表</Button>
            <Button variant="primary" loading={saving} onClick={submit}>保存题目</Button>
          </>
        }
        meta={
          isEdit && origin ? (
            <>
              <Tag tone="cyan">{origin.questionNo}</Tag>
              <Tag tone="violet">{QUESTION_TYPE_LABEL[origin.questionType]}</Tag>
              <Tag tone="neutral">当前版本 v{origin.currentVersion}</Tag>
              <span className="xs muted">创建于 {formatDateTime(origin.createdAt)}</span>
            </>
          ) : null
        }
      />

      <div className="stats-layout">
        <div className="form-card">
          <QuestionEditor
            value={value}
            onChange={setValue}
            errors={errs}
            banks={banks}
            knowledgePoints={knowledgePoints}
          />
          <div className="form-actions">
            <Button variant="primary" loading={saving} onClick={submit}>
              {isEdit ? '保存修改' : '创建题目'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/teacher/questions')}>取消</Button>
            {errs && Object.keys(errs).length ? (
              <span className="xs" style={{ color: 'var(--oe-danger-ink)' }}>存在 {Object.keys(errs).length} 处校验错误</span>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">版本历史</span>
            <span className="xs muted">{versions.length} 条</span>
          </div>
          <div className="card-pad" style={{ maxHeight: 620, overflow: 'auto' }}>
            {!isEdit ? (
              <p className="small muted" style={{ lineHeight: 1.8 }}>
                保存题目后将生成第 1 版快照，后续每次修改都会追加版本记录（修改人、时间、变更摘要）。
              </p>
            ) : versions.length === 0 ? (
              <p className="small muted">暂无版本记录（接口返回为空）。</p>
            ) : (
              <ul className="col gap-3">
                {versions.map((v) => (
                  <li key={v.id} style={{ paddingBottom: 10, borderBottom: '1px dashed var(--oe-core-border)' }}>
                    <div className="row-between">
                      <b className="small mono">v{v.versionNo}</b>
                      <Tag tone={v.changeType === 'create' ? 'green' : v.changeType === 'rejudge' ? 'red' : 'cyan'}>
                        {v.changeType === 'create' ? '创建' : v.changeType === 'rejudge' ? '重判' : '修改'}
                      </Tag>
                    </div>
                    <div className="xs muted" style={{ marginTop: 4 }}>
                      {v.changedByName || '—'} · {formatDateTime(v.createdAt)}
                    </div>
                    {v.changeSummary ? <div className="xs" style={{ marginTop: 4 }}>{v.changeSummary}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}