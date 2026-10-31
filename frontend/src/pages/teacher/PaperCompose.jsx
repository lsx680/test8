import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  addPaperQuestions,
  createPaper,
  getPaper,
  randomAssemblePaper,
  removePaperQuestion,
  updatePaper,
  updatePaperQuestions,
} from '../../api/papers.js';
import { listQuestionBanks, listQuestions } from '../../api/questions.js';
import { listKnowledgePoints } from '../../api/knowledge.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import { FormField, Input, Select, Textarea } from '../../components/Form.jsx';
import { formatScore, truncate } from '../../utils/format.js';
import { QUESTION_TYPE_LABEL, QUESTION_TYPES, DIFFICULTY_LABEL } from '../../utils/enums.js';
import { integerRange, maxLen, numberRange, required, runRules } from '../../utils/validate.js';

const DEFAULT_DIST = { 1: 20, 2: 30, 3: 30, 4: 15, 5: 5 };

const emptyRule = (questionType) => ({
  questionType,
  count: 5,
  scorePerQuestion: 2,
  dist: { ...DEFAULT_DIST },
});

/**
 * 组卷编辑器（REQ-PPM-01 / 02 / 03）
 * - 新建：手动组卷（逐题加入、实时累计题数与总分）或规则化随机组卷（缺口提示）
 * - 编辑：调整顺序与分值、追加/移除题目；锁定状态禁止改动题目
 * 契约：POST /papers、POST /papers/random、GET/PUT /papers/{id}、
 *      POST|PUT /papers/{id}/questions、DELETE /papers/{id}/questions/{pqId}
 */
export default function PaperCompose() {
  const { paperId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const isEdit = Boolean(paperId);

  const [mode, setMode] = useState('manual'); // manual | random
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState('');
  const [paper, setPaper] = useState(null);

  // 基本信息
  const [base, setBase] = useState({ paperName: '', description: '', totalScore: '', durationMinutes: 60 });
  const [baseErrs, setBaseErrs] = useState({});
  const [saving, setSaving] = useState(false);

  // 手动组卷
  const [selected, setSelected] = useState([]); // {questionId, paperQuestionId?, stem, questionType, score}
  const [removedIds, setRemovedIds] = useState([]);
  const [banks, setBanks] = useState([]);
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [filter, setFilter] = useState({ keyword: '', bankId: '', questionType: '', difficulty: '' });
  const [candidates, setCandidates] = useState({ list: [], total: 0, page: 1, pageSize: 8 });
  const [candLoading, setCandLoading] = useState(false);
  const [candError, setCandError] = useState('');

  // 随机组卷
  const [randomForm, setRandomForm] = useState({
    paperName: '',
    totalScore: '',
    durationMinutes: 60,
    bankIds: [],
    knowledgePointIds: [],
    rules: QUESTION_TYPES.map((t, index) => ({ ...emptyRule(t), count: index === 0 ? 10 : 0 })),
  });
  const [randomErrs, setRandomErrs] = useState({});
  const [shortages, setShortages] = useState(null);

  const locked = paper?.status === 'locked' || paper?.status === 'archived';
  // 编辑已有试卷时始终进入题目结构视图（即使原卷由随机组卷生成），
  // 否则会展示空白的随机组卷规则表单
  const effectiveMode = isEdit ? 'manual' : mode;

  /* ---------------- 初始化 ---------------- */
  useEffect(() => {
    let alive = true;
    const tasks = [listQuestionBanks({ page: 1, pageSize: 100 }).catch(() => ({ list: [] })), listKnowledgePoints({}).catch(() => [])];
    if (isEdit) tasks.push(getPaper(paperId));
    Promise.all(tasks)
      .then(([bankPage, kpList, detail]) => {
        if (!alive) return;
        setBanks(bankPage?.list || []);
        setKnowledgePoints(Array.isArray(kpList) ? kpList : []);
        if (detail) {
          setPaper(detail);
          setBase({
            paperName: detail.paperName || '',
            description: detail.description || '',
            totalScore: detail.totalScore ?? '',
            durationMinutes: detail.durationMinutes ?? 60,
          });
          setSelected(
            (detail.questions || []).map((q) => ({
              questionId: q.questionId,
              paperQuestionId: q.paperQuestionId,
              stem: q.stem,
              questionType: q.questionType,
              score: q.score,
            })),
          );
          setMode(detail.assemblyMode === 'random' ? 'random' : 'manual');
        }
        setLoading(false);
      })
      .catch((err) => {
        if (alive) {
          setError(err?.displayMessage || '试卷加载失败');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [paperId, isEdit]);

  /* ---------------- 题目候选检索 ---------------- */
  const loadCandidates = async (page = 1) => {
    setCandLoading(true);
    setCandError('');
    try {
      const params = { page, pageSize: 8 };
      Object.entries(filter).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) params[k] = v;
      });
      const result = await listQuestions(params);
      setCandidates({ list: result?.list || [], total: result?.total || 0, page, pageSize: 8 });
    } catch (err) {
      setCandError(err?.displayMessage || '题目检索失败');
    } finally {
      setCandLoading(false);
    }
  };

  useEffect(() => {
    if (!isEdit) loadCandidates(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  const totalScore = useMemo(
    () => selected.reduce((sum, item) => sum + (Number(item.score) || 0), 0),
    [selected],
  );

  const addQuestion = (q) => {
    if (selected.some((s) => s.questionId === q.id)) {
      toast.info('该题目已在试卷中');
      return;
    }
    setSelected((prev) => [
      ...prev,
      {
        questionId: q.id,
        stem: q.stem,
        questionType: q.questionType,
        score: q.defaultScore ?? 2,
      },
    ]);
    if (!base.totalScore) setBase((prev) => ({ ...prev, totalScore: totalScore + (Number(q.defaultScore) || 2) }));
  };

  const removeSelected = (questionId) => {
    const target = selected.find((s) => s.questionId === questionId);
    if (target?.paperQuestionId) setRemovedIds((prev) => [...prev, { questionId, paperQuestionId: target.paperQuestionId }]);
    setSelected((prev) => prev.filter((s) => s.questionId !== questionId));
  };

  const move = (index, delta) => {
    setSelected((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /* ---------------- 保存（手动） ---------------- */
  const validateBase = () => {
    const result = runRules(base, {
      paperName: [(v) => required(v, '试卷名称'), (v) => maxLen(v, 128, '试卷名称')],
      description: [(v) => maxLen(v, 500, '说明')],
      totalScore: [(v) => numberRange(v, 0.5, 1000, '总分')],
      durationMinutes: [(v) => integerRange(v, 1, 180, '答题时长')],
    });
    setBaseErrs(result.errors);
    return result.valid;
  };

  const saveManual = async () => {
    if (!validateBase()) return;
    if (selected.length === 0) {
      toast.warning('试卷至少需要 1 道题');
      return;
    }
    const diff = Number(base.totalScore) - totalScore;
    if (Math.abs(diff) > 0.001) {
      toast.warning(`各题分值之和为 ${formatScore(totalScore)}，与设定总分 ${base.totalScore} 不一致（差额 ${formatScore(diff)}）`);
      return;
    }

    setSaving(true);
    try {
      if (!isEdit) {
        const created = await createPaper({
          paperName: base.paperName.trim(),
          ...(base.description ? { description: base.description.trim() } : {}),
          totalScore: Number(base.totalScore),
          durationMinutes: Number(base.durationMinutes),
          questions: selected.map((s, i) => ({
            questionId: s.questionId,
            score: Number(s.score),
            orderNo: i + 1,
            sectionNo: 1,
          })),
        });
        toast.success('试卷已创建');
        navigate(`/teacher/papers/${created.id}/edit`);
        return;
      }

      // 编辑模式：先移除、再追加、最后全量更新顺序与分值
      await updatePaper(
        paperId,
        locked
          ? {
              // 锁定/归档状态下服务端仅允许修改名称与说明（30103 保护题目与分值）
              paperName: base.paperName.trim(),
              description: base.description,
            }
          : {
              paperName: base.paperName.trim(),
              ...(base.description !== undefined ? { description: base.description } : {}),
              totalScore: Number(base.totalScore),
              durationMinutes: Number(base.durationMinutes),
            },
      );

      if (!locked) {
        for (const item of removedIds) {
          await removePaperQuestion(paperId, item.paperQuestionId);
        }
        const added = selected.filter((s) => !s.paperQuestionId);
        if (added.length) {
          const submitted = await addPaperQuestions(
            paperId,
            added.map((s) => ({ questionId: s.questionId, score: Number(s.score), sectionNo: 1 })),
          );
          setSelected(
            (submitted.questions || []).map((q) => ({
              questionId: q.questionId,
              paperQuestionId: q.paperQuestionId,
              stem: q.stem,
              questionType: q.questionType,
              score: q.score,
            })),
          );
        } else {
          const fresh = await getPaper(paperId);
          const payload = selected.map((s, index) => {
            const match = (fresh.questions || []).find((q) => q.questionId === s.questionId);
            return {
              paperQuestionId: match?.paperQuestionId,
              score: Number(s.score),
              orderNo: index + 1,
              sectionNo: 1,
            };
          }).filter((item) => item.paperQuestionId);
          if (payload.length) await updatePaperQuestions(paperId, payload);
          setSelected(
            (fresh.questions || []).map((q) => ({
              questionId: q.questionId,
              paperQuestionId: q.paperQuestionId,
              stem: q.stem,
              questionType: q.questionType,
              score: q.score,
            })),
          );
        }
        setRemovedIds([]);
      }

      toast.success('试卷已保存');
      const fresh = await getPaper(paperId);
      setPaper(fresh);
      setBase({
        paperName: fresh.paperName,
        description: fresh.description || '',
        totalScore: fresh.totalScore,
        durationMinutes: fresh.durationMinutes,
      });
    } catch (err) {
      toast.error(err?.displayMessage || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- 随机组卷 ---------------- */
  const validateRandom = () => {
    const next = {};
    if (!randomForm.paperName.trim()) next.paperName = '试卷名称不能为空';
    const totalMsg = numberRange(randomForm.totalScore, 0.5, 1000, '总分');
    if (totalMsg) next.totalScore = totalMsg;
    const durationMsg = integerRange(randomForm.durationMinutes, 1, 180, '答题时长');
    if (durationMsg) next.durationMinutes = durationMsg;

    const activeRules = randomForm.rules.filter((r) => Number(r.count) > 0);
    if (!activeRules.length) next.rules = '至少配置一种题型的抽题数量';
    let sum = 0;
    activeRules.forEach((r) => {
      const countMsg = integerRange(r.count, 1, 200, `${QUESTION_TYPE_LABEL[r.questionType]}数量`);
      if (countMsg) next[`rule-${r.questionType}`] = countMsg;
      const scoreMsg = numberRange(r.scorePerQuestion, 0.5, 100, `${QUESTION_TYPE_LABEL[r.questionType]}单题分值`);
      if (scoreMsg) next[`rule-${r.questionType}`] = scoreMsg;
      sum += Number(r.count) * Number(r.scorePerQuestion);
      const distSum = Object.values(r.dist).reduce((a, b) => a + Number(b || 0), 0);
      if (Math.abs(distSum - 100) > 0.01) next[`dist-${r.questionType}`] = '难度占比之和须为 100%';
    });
    if (!next.totalScore && Math.abs(sum - Number(randomForm.totalScore)) > 0.001) {
      next.totalScore = `各题型分值合计 ${sum} 分，与设定总分 ${randomForm.totalScore} 不一致`;
    }
    setRandomErrs(next);
    return Object.keys(next).length === 0;
  };

  const saveRandom = async () => {
    if (!validateRandom()) return;
    setShortages(null);
    setSaving(true);
    try {
      const payload = {
        paperName: randomForm.paperName.trim(),
        totalScore: Number(randomForm.totalScore),
        durationMinutes: Number(randomForm.durationMinutes),
        bankIds: randomForm.bankIds.map(Number),
        knowledgePointIds: randomForm.knowledgePointIds.map(Number),
        rules: randomForm.rules
          .filter((r) => Number(r.count) > 0)
          .map((r) => ({
            questionType: r.questionType,
            count: Number(r.count),
            scorePerQuestion: Number(r.scorePerQuestion),
            difficultyDistribution: Object.fromEntries(
              Object.entries(r.dist).map(([k, v]) => [k, Number(v) / 100]),
            ),
          })),
        saveDraft: true,
      };
      const result = await randomAssemblePaper(payload);
      toast.success(`随机组卷成功，共 ${result?.questionCount ?? 0} 题`);
      navigate(`/teacher/papers/${result.paperId}/edit`);
    } catch (err) {
      if (err?.status === 409 && err.data?.shortages) {
        setShortages(err.data.shortages);
        toast.warning('可用题目不足，未生成残缺试卷');
      } else {
        toast.error(err?.displayMessage || '随机组卷失败');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page"><Loading text="正在加载试卷结构…" minHeight={360} /></div>;
  }
  if (error) {
    return <div className="page"><ErrorState message={error} onRetry={() => window.location.reload()} /></div>;
  }

  return (
    <div className="page">
      <PageHeader
        title={isEdit ? `编辑试卷 · ${paper?.paperName || ''}` : '新建试卷'}
        desc={
          isEdit
            ? '被考试引用的试卷已锁定，仅可修改名称与说明。调整题目顺序与分值后需保证分值与总分一致。'
            : '手动逐题加入或按题型、难度比例随机抽题；可用题目不足时返回缺口明细，不生成残缺试卷。'
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/teacher/papers')}>返回列表</Button>
            {effectiveMode === 'manual' ? (
              <Button variant="primary" loading={saving} onClick={saveManual}>保存试卷</Button>
            ) : (
              <Button variant="primary" loading={saving} onClick={saveRandom}>生成随机试卷</Button>
            )}
          </>
        }
        meta={
          isEdit ? (
            <>
              <Tag tone={locked ? 'amber' : 'green'}>{locked ? '已锁定' : '可编辑'}</Tag>
              <Tag tone="cyan">{paper?.questionCount ?? selected.length} 题</Tag>
              <Tag tone="violet">总分 {formatScore(paper?.totalScore ?? totalScore)}</Tag>
            </>
          ) : null
        }
      />

      {!isEdit ? (
        <div className="row gap-2" style={{ marginBottom: 14 }}>
          <button type="button" className={`btn btn-sm ${mode === 'manual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('manual')}>
            手动组卷
          </button>
          <button type="button" className={`btn btn-sm ${mode === 'random' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('random')}>
            规则化随机组卷
          </button>
        </div>
      ) : null}

      {effectiveMode === 'manual' ? (
        <div className="stats-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)' }}>
          {/* 左：题目候选 */}
          <section className="form-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="form-section-title">从题库选题</h2>
            <div className="row gap-2 row-wrap" style={{ marginBottom: 10 }}>
              <Input
                placeholder="题干关键词"
                style={{ width: 180 }}
                value={filter.keyword}
                onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && loadCandidates(1)}
              />
              <Select style={{ width: 130 }} value={filter.bankId} onChange={(e) => setFilter({ ...filter, bankId: e.target.value })}>
                <option value="">全部题库</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.bankName}</option>)}
              </Select>
              <Select style={{ width: 120 }} value={filter.questionType} onChange={(e) => setFilter({ ...filter, questionType: e.target.value })}>
                <option value="">全部题型</option>
                {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
              </Select>
              <Button size="sm" variant="secondary" onClick={() => loadCandidates(1)}>检索</Button>
            </div>

            {candLoading ? (
              <Loading text="正在检索题目…" minHeight={200} />
            ) : candError ? (
              <ErrorState message={candError} onRetry={() => loadCandidates(candidates.page)} minHeight={200} />
            ) : candidates.list.length === 0 ? (
              <div className="state-box" style={{ minHeight: 200 }}>
                <span className="state-icon">◌</span>
                <span className="state-title">没有可用题目</span>
                <span className="state-desc">可调整筛选条件或先到题库中新增题目。</span>
              </div>
            ) : (
              <div className="col gap-2" style={{ flex: 1, overflow: 'auto', maxHeight: 520 }}>
                {candidates.list.map((q) => {
                  const picked = selected.some((s) => s.questionId === q.id);
                  return (
                    <div
                      key={q.id}
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--oe-core-border)',
                        borderRadius: 8,
                        background: picked ? '#eff9fb' : '#fff',
                      }}
                    >
                      <div className="row-between">
                        <span className="xs muted mono">{q.questionNo}</span>
                        <span className="row gap-2">
                          <Tag tone="neutral">{QUESTION_TYPE_LABEL[q.questionType]}</Tag>
                          <span className="mono xs">{formatScore(q.defaultScore)} 分</span>
                        </span>
                      </div>
                      <p className="small" style={{ margin: '6px 0', lineHeight: 1.6 }}>{truncate(q.stem, 88)}</p>
                      <div className="row-between">
                        <span className="xs muted">难度 {q.difficulty} · {DIFFICULTY_LABEL[q.difficulty]}{q.knowledgePointName ? ` · ${q.knowledgePointName}` : ''}</span>
                        <Button size="sm" variant={picked ? 'ghost' : 'secondary'} disabled={picked || locked} onClick={() => addQuestion(q)}>
                          {picked ? '已加入' : '加入试卷'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="row-between" style={{ marginTop: 10 }}>
              <span className="xs muted">共 {candidates.total} 题</span>
              <div className="pager">
                <button type="button" disabled={candidates.page <= 1} onClick={() => loadCandidates(candidates.page - 1)}>上一页</button>
                <button type="button" disabled={candidates.page * 8 >= candidates.total} onClick={() => loadCandidates(candidates.page + 1)}>下一页</button>
              </div>
            </div>
          </section>

          {/* 右：试卷结构 */}
          <section className="form-card">
            <h2 className="form-section-title">试卷信息</h2>
            <div className="form-grid-2">
              <FormField label="试卷名称" required error={baseErrs.paperName}>
                {(f) => <Input id={f.id} invalid={f.invalid} value={base.paperName} onChange={(e) => setBase({ ...base, paperName: e.target.value })} placeholder="如：2026 秋季《数据结构》期中试卷" />}
              </FormField>
              <FormField label="答题时长（分钟）" required error={baseErrs.durationMinutes}>
                {(f) => <Input id={f.id} type="number" min="1" max="180" invalid={f.invalid} value={base.durationMinutes} onChange={(e) => setBase({ ...base, durationMinutes: e.target.value })} />}
              </FormField>
            </div>
            <FormField label="说明" error={baseErrs.description}>
              {(f) => <Textarea id={f.id} rows={2} invalid={f.invalid} value={base.description} onChange={(e) => setBase({ ...base, description: e.target.value })} />}
            </FormField>

            <hr className="divider" />
            <div className="row-between" style={{ marginBottom: 10 }}>
              <b className="small">题目结构（{selected.length} 题）</b>
              <span className="mono small">合计 {formatScore(totalScore)} 分</span>
            </div>

            {selected.length === 0 ? (
              <div className="state-box" style={{ minHeight: 160 }}>
                <span className="state-icon">◌</span>
                <span className="state-title">尚未加入题目</span>
                <span className="state-desc">从左侧题库中选择题目加入试卷。</span>
              </div>
            ) : (
              <div className="col gap-2" style={{ maxHeight: 380, overflow: 'auto' }}>
                {selected.map((item, index) => (
                  <div key={item.questionId} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 92px 104px', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed var(--oe-core-border)' }}>
                    <span className="mono xs muted">{index + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="small truncate">{item.stem}</div>
                      <div className="xs muted">{QUESTION_TYPE_LABEL[item.questionType]}</div>
                    </div>
                    <Input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={item.score}
                      disabled={locked}
                      style={{ height: 32 }}
                      onChange={(e) =>
                        setSelected((prev) => prev.map((s, i) => (i === index ? { ...s, score: e.target.value } : s)))
                      }
                    />
                    <div className="cell-actions">
                      <Button size="sm" variant="ghost" disabled={locked || index === 0} onClick={() => move(index, -1)}>↑</Button>
                      <Button size="sm" variant="ghost" disabled={locked || index === selected.length - 1} onClick={() => move(index, 1)}>↓</Button>
                      <Button size="sm" variant="ghost" disabled={locked} onClick={() => removeSelected(item.questionId)}>移除</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="form-grid-2" style={{ marginTop: 16 }}>
              <FormField label="设定总分" required error={baseErrs.totalScore} hint="必须等于各题分值之和">
                {(f) => (
                  <Input
                    id={f.id}
                    type="number"
                    min="0.5"
                    step="0.5"
                    invalid={f.invalid}
                    value={base.totalScore}
                    onChange={(e) => setBase({ ...base, totalScore: e.target.value })}
                  />
                )}
              </FormField>
              <div style={{ paddingTop: 26 }}>
                <Tag tone={Math.abs(Number(base.totalScore || 0) - totalScore) < 0.001 ? 'green' : 'red'}>
                  分值与总分{Math.abs(Number(base.totalScore || 0) - totalScore) < 0.001 ? '一致' : `差额 ${formatScore(Number(base.totalScore || 0) - totalScore)}`}
                </Tag>
              </div>
            </div>

            <div className="form-actions">
              <Button variant="primary" loading={saving} onClick={saveManual}>保存试卷</Button>
              <Button variant="secondary" onClick={() => setBase({ ...base, totalScore: totalScore })}>
                用题目合计填充总分
              </Button>
              {locked ? <span className="xs" style={{ color: 'var(--oe-warning-ink)' }}>试卷已锁定，题目与分值不可修改</span> : null}
            </div>
          </section>
        </div>
      ) : (
        <div className="form-card">
          <h2 className="form-section-title">随机组卷规则</h2>
          <div className="form-grid-3">
            <FormField label="试卷名称" required error={randomErrs.paperName}>
              {(f) => <Input id={f.id} invalid={f.invalid} value={randomForm.paperName} onChange={(e) => setRandomForm({ ...randomForm, paperName: e.target.value })} />}
            </FormField>
            <FormField label="设定总分" required error={randomErrs.totalScore}>
              {(f) => <Input id={f.id} type="number" min="0.5" step="0.5" invalid={f.invalid} value={randomForm.totalScore} onChange={(e) => setRandomForm({ ...randomForm, totalScore: e.target.value })} />}
            </FormField>
            <FormField label="答题时长（分钟）" required error={randomErrs.durationMinutes}>
              {(f) => <Input id={f.id} type="number" min="1" max="180" invalid={f.invalid} value={randomForm.durationMinutes} onChange={(e) => setRandomForm({ ...randomForm, durationMinutes: e.target.value })} />}
            </FormField>
          </div>

          <div className="form-grid-2">
            <FormField label="题库范围" hint="不选表示全部可用题库">
              <div className="perm-grid">
                {banks.map((b) => (
                  <label className="perm-item" key={b.id}>
                    <input
                      type="checkbox"
                      checked={randomForm.bankIds.includes(String(b.id))}
                      onChange={(e) =>
                        setRandomForm({
                          ...randomForm,
                          bankIds: e.target.checked
                            ? [...randomForm.bankIds, String(b.id)]
                            : randomForm.bankIds.filter((id) => id !== String(b.id)),
                        })
                      }
                    />
                    <span className="small">{b.bankName}</span>
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="知识点范围" hint="不选表示全部知识点">
              <div className="perm-grid" style={{ maxHeight: 180, overflow: 'auto' }}>
                {knowledgePoints.map((kp) => (
                  <label className="perm-item" key={kp.id}>
                    <input
                      type="checkbox"
                      checked={randomForm.knowledgePointIds.includes(String(kp.id))}
                      onChange={(e) =>
                        setRandomForm({
                          ...randomForm,
                          knowledgePointIds: e.target.checked
                            ? [...randomForm.knowledgePointIds, String(kp.id)]
                            : randomForm.knowledgePointIds.filter((id) => id !== String(kp.id)),
                        })
                      }
                    />
                    <span className="small">{kp.kpName}</span>
                  </label>
                ))}
              </div>
            </FormField>
          </div>

          <hr className="divider" />
          <div className="row-between" style={{ marginBottom: 10 }}>
            <b className="small">题型抽题规则</b>
            <span className="mono small">
              合计 {randomForm.rules.reduce((s, r) => s + (Number(r.count) || 0) * (Number(r.scorePerQuestion) || 0), 0)} 分
            </span>
          </div>

          {randomForm.rules.map((rule, index) => (
            <div key={rule.questionType} style={{ padding: '12px 0', borderBottom: '1px dashed var(--oe-core-border)' }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <b className="small">{QUESTION_TYPE_LABEL[rule.questionType]}</b>
                {randomErrs[`rule-${rule.questionType}`] ? <span className="field-error">{randomErrs[`rule-${rule.questionType}`]}</span> : null}
                {randomErrs[`dist-${rule.questionType}`] ? <span className="field-error">{randomErrs[`dist-${rule.questionType}`]}</span> : null}
              </div>
              <div className="form-grid-3">
                <FormField label="抽题数量">
                  {(f) => (
                    <Input
                      id={f.id}
                      type="number"
                      min="0"
                      value={rule.count}
                      onChange={(e) => {
                        const rules = [...randomForm.rules];
                        rules[index] = { ...rule, count: e.target.value };
                        setRandomForm({ ...randomForm, rules });
                      }}
                    />
                  )}
                </FormField>
                <FormField label="每题分值">
                  {(f) => (
                    <Input
                      id={f.id}
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={rule.scorePerQuestion}
                      onChange={(e) => {
                        const rules = [...randomForm.rules];
                        rules[index] = { ...rule, scorePerQuestion: e.target.value };
                        setRandomForm({ ...randomForm, rules });
                      }}
                    />
                  )}
                </FormField>
                <FormField label="难度占比（%）" hint="1 最易 → 5 最难，合计 100">
                  <div className="row gap-1">
                    {[1, 2, 3, 4, 5].map((d) => (
                      <Input
                        key={d}
                        type="number"
                        min="0"
                        max="100"
                        title={`难度 ${d}（${DIFFICULTY_LABEL[d]}）`}
                        value={rule.dist[d]}
                        style={{ width: 58, padding: '6px 4px', textAlign: 'center' }}
                        onChange={(e) => {
                          const rules = [...randomForm.rules];
                          rules[index] = { ...rule, dist: { ...rule.dist, [d]: e.target.value } };
                          setRandomForm({ ...randomForm, rules });
                        }}
                      />
                    ))}
                  </div>
                </FormField>
              </div>
            </div>
          ))}

          {shortages ? (
            <div className="alert-bar danger" style={{ marginTop: 14 }}>
              <div>
                <b>可用题目不足，未生成残缺试卷。</b>
                <ul style={{ marginTop: 6 }}>
                  {shortages.map((s, i) => (
                    <li key={i} className="small">
                      · {s.dimension === 'questionType' ? '题型' : s.dimension === 'difficulty' ? '难度' : '知识点'}：
                      需要 {s.requiredCount}，可用 {s.availableCount}，缺口 {s.shortageCount}
                      {s.questionType ? `（${QUESTION_TYPE_LABEL[s.questionType]}）` : ''}
                      {s.difficulty ? `（难度 ${s.difficulty}）` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="form-actions">
            <Button variant="primary" loading={saving} onClick={saveRandom}>生成试卷草稿</Button>
            <Button
              variant="secondary"
              onClick={() =>
                setRandomForm({
                  ...randomForm,
                  rules: QUESTION_TYPES.map((t, index) => ({ ...emptyRule(t), count: index === 0 ? 10 : 0 })),
                })
              }
            >
              重置规则
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}