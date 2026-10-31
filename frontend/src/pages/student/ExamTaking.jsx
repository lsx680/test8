import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getRemainingTime,
  recoverAttempt,
  reportAntiCheatEvent,
  saveAnswers,
  submitAttempt,
} from '../../api/attempts.js';
import { toast } from '../../store/uiStore.js';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import Countdown from '../../components/Countdown.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import { Textarea } from '../../components/Form.jsx';
import { formatClock, formatScore, displayAnswer } from '../../utils/format.js';
import { QUESTION_TYPE_LABEL, QUESTION_TYPE_TAG } from '../../utils/enums.js';

/**
 * 在线答题（REQ-EXM-04 ~ EXM-09，核心页面）
 * ------------------------------------------------------------
 * 关键机制：
 * 1. 服务端权威计时：以 recoverAttempt 返回的 serverTime 计算客户端偏移，
 *    剩余秒数由 deadlineAt - (本地时间 + 偏移) 推导；每 30s 调
 *    GET /attempts/{id}/remaining-time 校准，本页倒计时仅用于展示。
 * 2. 答案自动暂存：修改答案后 3s 防抖 PUT /attempts/{id}/answers；切题立即 flush；
 *    保存失败保留 dirty 队列并 3s 后重试，失败不阻断答题。
 * 3. 交卷：二次确认（展示未作答数），交卷前强制 flush；超时归零自动交卷并提示。
 * 4. 防作弊：visibilitychange / blur / copy / paste / 退出全屏 统一上报，
 *    同类事件 2s 节流，失败静默重试一次。
 * 5. 断线恢复：刷新或断网重进调用同一恢复接口，不重复计时、不丢失已存答案。
 */
export default function ExamTaking() {
  const { attemptId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const answersRef = useRef({});
  const [saveState, setSaveState] = useState('idle'); // idle | dirty | saving | saved | error
  const [savedAt, setSavedAt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [timeoutNotice, setTimeoutNotice] = useState(false);
  const [elapsedZero, setElapsedZero] = useState(false);

  const deadlineRef = useRef(null);
  const offsetRef = useRef(0);
  const remainingRef = useRef(0);
  const dirtyRef = useRef(new Set());
  const savingRef = useRef(false);
  const debounceRef = useRef(null);
  const retryRef = useRef(null);
  const submittedRef = useRef(false);
  const tickRef = useRef(null);
  const calibrateRef = useRef(null);

  const [remaining, setRemaining] = useState(0);
  remainingRef.current = remaining;

  /* ---------------- 计算剩余秒数（服务端校准后的 deadline） ---------------- */
  const computeRemaining = useCallback(() => {
    if (deadlineRef.current) {
      const ms = deadlineRef.current - (Date.now() + offsetRef.current);
      return Math.max(0, Math.round(ms / 1000));
    }
    return Math.max(0, remainingRef.current - 1);
  }, []);

  /* ---------------- 初始化：恢复答卷 ---------------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    recoverAttempt(attemptId)
      .then((data) => {
        if (!alive) return;
        setSession(data);
        const serverMs = new Date(data.serverTime || Date.now()).getTime();
        offsetRef.current = serverMs - Date.now();
        if (data.deadlineAt) deadlineRef.current = new Date(data.deadlineAt).getTime();
        const seconds = Number.isFinite(data.remainingSeconds) ? data.remainingSeconds : 0;
        setRemaining(seconds);
        remainingRef.current = seconds;

        const initial = {};
        (data.questions || []).forEach((q) => {
          initial[q.questionId] = Array.isArray(q.studentAnswer) ? [...q.studentAnswer] : [];
        });
        answersRef.current = initial;
        setAnswers(initial);
        setSaveState('saved');
        if (data.status !== 'ongoing') {
          setFinished(true);
          submittedRef.current = true;
        }
      })
      .catch((err) => {
        if (alive) setError(err?.displayMessage || '答卷加载失败，请稍后重试');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attemptId]);

  /* ---------------- 保存答案 ---------------- */
  const saveNow = useCallback(async () => {
    if (!attemptId || savingRef.current) return;
    const ids = Array.from(dirtyRef.current);
    if (!ids.length) return;

    savingRef.current = true;
    dirtyRef.current.clear();
    setSaveState('saving');
    try {
      const payload = ids.map((qid) => ({
        questionId: Number(qid),
        answer: answersRef.current[qid] || [],
      }));
      const res = await saveAnswers(attemptId, payload);
      setSavedAt(res?.savedAt || new Date().toISOString());
      if (Number.isFinite(res?.remainingSeconds)) setRemaining(res.remainingSeconds);
      setSaveState(dirtyRef.current.size ? 'dirty' : 'saved');
    } catch (err) {
      // 答卷已交卷/超时：停止重试，避免无意义的循环请求
      if (err?.code === 40109) {
        dirtyRef.current.clear();
        setSaveState('error');
        return;
      }
      // 保存失败：回填 dirty 队列并延迟重试，不中断答题
      ids.forEach((id) => dirtyRef.current.add(id));
      setSaveState('error');
      clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => saveNow(), 3000);
    } finally {
      savingRef.current = false;
    }
  }, [attemptId]);

  /* ---------------- 时钟：本地每秒渲染 + 每 30s 服务端校准 ---------------- */
  const autoSubmitRef = useRef(() => {});

  useEffect(() => {
    if (!session || finished) return undefined;
    tickRef.current = setInterval(() => {
      const next = computeRemaining();
      setRemaining(next);
      if (next <= 0) {
        setElapsedZero(true);
        if (!submittedRef.current) autoSubmitRef.current();
      }
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [session, finished, computeRemaining]);

  useEffect(() => {
    if (!session || finished) return undefined;
    calibrateRef.current = setInterval(async () => {
      if (submittedRef.current) return;
      try {
        const data = await getRemainingTime(attemptId);
        if (data?.serverTime) {
          offsetRef.current = new Date(data.serverTime).getTime() - Date.now();
        }
        if (data?.deadlineAt) deadlineRef.current = new Date(data.deadlineAt).getTime();
        const seconds = Number(data?.remainingSeconds ?? 0);
        setRemaining(seconds);
        remainingRef.current = seconds;
        if (seconds <= 0) {
          setElapsedZero(true);
          if (!submittedRef.current) autoSubmitRef.current();
        }
      } catch {
        // 校准失败不影响本地倒计时展示；下一轮继续尝试
      }
    }, 30000);
    return () => clearInterval(calibrateRef.current);
  }, [attemptId, session, finished]);

  /* ---------------- 交卷 ---------------- */
  const doSubmit = useCallback(
    async (submitType = 'manual') => {
      if (submittedRef.current && submitType === 'manual') return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        // 等待进行中的暂存结束后，再强制 flush 未保存答案（服务端交卷幂等）
        let waited = 0;
        while (savingRef.current && waited < 2000) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 100));
          waited += 100;
        }
        await saveNow();
        const res = await submitAttempt(attemptId, submitType);
        clearInterval(tickRef.current);
        clearInterval(calibrateRef.current);
        clearTimeout(debounceRef.current);
        clearTimeout(retryRef.current);
        setResult({ ...res, submitType });
        setConfirmOpen(false);
        if (submitType === 'timeout') {
          setTimeoutNotice(true);
          toast.warning('剩余时间已归零，系统已自动交卷');
        } else {
          toast.success('交卷成功');
        }
      } catch (err) {
        submittedRef.current = false;
        toast.error(err?.displayMessage || '交卷失败，请重试');
      } finally {
        setSubmitting(false);
      }
    },
    [attemptId, saveNow],
  );

  useEffect(() => {
    autoSubmitRef.current = () => doSubmit('timeout');
  }, [doSubmit]);

  /* ---------------- 答案变更与防抖暂存 ---------------- */
  const markAnswer = (questionId, value) => {
    const next = { ...answersRef.current, [questionId]: value };
    answersRef.current = next;
    setAnswers(next);
    dirtyRef.current.add(questionId);
    setSaveState('dirty');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveNow(), 3000);
  };

  const goTo = (index) => {
    if (index < 0 || index >= (session?.questions?.length || 0)) return;
    saveNow();
    setCurrent(index);
  };

  /* ---------------- 防作弊采集 ---------------- */
  useEffect(() => {
    if (!session || finished) return undefined;
    const lastSent = {};
    const send = (eventType, detail) => {
      const now = Date.now();
      if (lastSent[eventType] && now - lastSent[eventType] < 2000) return;
      lastSent[eventType] = now;
      const payload = { eventType, detail: detail || null, clientTime: new Date().toISOString() };
      reportAntiCheatEvent(attemptId, payload).catch(() => {
        // 失败静默重试一次
        setTimeout(() => reportAntiCheatEvent(attemptId, payload).catch(() => {}), 1500);
      });
    };

    const onVisibility = () => {
      if (document.hidden) send('switch_screen', { visibility: 'hidden' });
    };
    const onBlur = () => send('blur', { reason: 'window_blur' });
    const onCopy = (e) => send('copy_paste', { type: e.type, length: String(window.getSelection() || '').length });
    const onFullscreen = () => {
      if (!document.fullscreenElement) send('exit_fullscreen', { reason: 'fullscreenchange' });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onCopy);
    document.addEventListener('fullscreenchange', onFullscreen);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onCopy);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [attemptId, session, finished]);

  /* ---------------- 进入全屏 + 刷新保护 + 卸载暂存 ---------------- */
  useEffect(() => {
    if (session?.status === 'ongoing') {
      // 浏览器可能因缺少用户手势拒绝，静默处理
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, [session?.status]);

  useEffect(() => {
    const handler = (e) => {
      if (!submittedRef.current && !finished) {
        e.preventDefault();
        e.returnValue = '考试进行中，离开页面可能导致答案未能保存。';
        return e.returnValue;
      }
      return undefined;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [finished]);

  useEffect(
    () => () => {
      clearInterval(tickRef.current);
      clearInterval(calibrateRef.current);
      clearTimeout(debounceRef.current);
      clearTimeout(retryRef.current);
      // 离开页面时尽力保存一次（不阻塞）
      if (!submittedRef.current && dirtyRef.current.size) {
        saveAnswers(attemptId, Array.from(dirtyRef.current).map((qid) => ({
          questionId: Number(qid),
          answer: answersRef.current[qid] || [],
        }))).catch(() => {});
      }
    },
    [attemptId],
  );

  const questions = session?.questions || [];
  const currentQuestion = questions[current];
  const unanswered = useMemo(
    () =>
      questions
        .map((q, index) => ({ q, index }))
        .filter(({ q }) => {
          const ans = answers[q.questionId];
          return !Array.isArray(ans) || ans.length === 0 || ans.every((v) => String(v ?? '').trim() === '');
        }),
    [questions, answers],
  );

  if (loading) {
    return (
      <div className="exam-shell">
        <Loading text="正在恢复答卷与剩余时间…" minHeight="100vh" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="exam-shell" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card" style={{ width: 'min(560px, 92vw)' }}>
          <ErrorState
            message={error}
            onRetry={() => window.location.reload()}
            title="答卷无法加载"
          />
          <div style={{ padding: '0 0 20px', textAlign: 'center' }}>
            <Button variant="secondary" onClick={() => navigate('/student/exams')}>返回考试列表</Button>
          </div>
        </div>
      </div>
    );
  }

  if (finished || (session && session.status !== 'ongoing')) {
    return (
      <div className="exam-shell" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="card card-pad" style={{ width: 'min(560px, 92vw)', textAlign: 'center' }}>
          <div className="state-icon" style={{ margin: '0 auto 12px' }}>✓</div>
          <h1 className="page-title" style={{ fontSize: 22 }}>该答卷已交卷</h1>
          <p className="small muted mt-3" style={{ lineHeight: 1.8 }}>
            {session?.examName || '本场考试'} 的答卷已提交，无法继续作答。成绩发布后可查看逐题得分与教师评语。
          </p>
          <div className="row gap-3" style={{ justifyContent: 'center', marginTop: 20 }}>
            <Button variant="primary" onClick={() => navigate('/student/results')}>查看我的成绩</Button>
            <Button variant="secondary" onClick={() => navigate('/student/exams')}>返回考试列表</Button>
          </div>
        </div>
      </div>
    );
  }

  const lockedByTime = remaining <= 0;
  const inputDisabled = lockedByTime || submitting || Boolean(result);

  const renderAnswerInput = (q) => {
    const value = answers[q.questionId] || [];
    if (q.questionType === 'single' || q.questionType === 'judge') {
      const options =
        q.questionType === 'judge'
          ? [{ key: 'true', content: '正确' }, { key: 'false', content: '错误' }]
          : q.options || [];
      return (
        <div className="option-list">
          {options.map((opt) => (
            <label key={opt.key} className={`option${value[0] === opt.key ? ' selected' : ''}`}>
              <input
                type="radio"
                name={`q-${q.questionId}`}
                checked={value[0] === opt.key}
                disabled={inputDisabled}
                onChange={() => markAnswer(q.questionId, [opt.key])}
              />
              <span className="option-key">{opt.key === 'true' ? '✓' : opt.key === 'false' ? '✗' : opt.key}</span>
              <span className="option-text">{opt.content}</span>
            </label>
          ))}
        </div>
      );
    }

    if (q.questionType === 'multiple') {
      return (
        <div className="option-list">
          {(q.options || []).map((opt) => {
            const checked = value.includes(opt.key);
            return (
              <label key={opt.key} className={`option${checked ? ' selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={inputDisabled}
                  onChange={() => {
                    const next = checked ? value.filter((k) => k !== opt.key) : [...value, opt.key];
                    markAnswer(q.questionId, next.sort());
                  }}
                />
                <span className="option-key">{opt.key}</span>
                <span className="option-text">{opt.content}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (q.questionType === 'fill') {
      const blanks = value.length ? value : [''];
      return (
        <div className="blank-list">
          {blanks.map((text, index) => (
            <div className="blank-row" key={`blank-${index}`}>
              <span>第 {index + 1} 空</span>
              <input
                className="input"
                value={text}
                disabled={inputDisabled}
                placeholder="请输入该空答案"
                onChange={(e) => {
                  const next = [...blanks];
                  next[index] = e.target.value;
                  markAnswer(q.questionId, next);
                }}
              />
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            disabled={inputDisabled}
            onClick={() => markAnswer(q.questionId, [...blanks, ''])}
          >
            + 添加空
          </Button>
        </div>
      );
    }

    return (
      <Textarea
        rows={7}
        value={value[0] || ''}
        disabled={inputDisabled}
        placeholder="请输入作答内容，可分点作答"
        onChange={(e) => markAnswer(q.questionId, [e.target.value])}
      />
    );
  };

  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'error'
        ? '保存失败，重试中'
        : saveState === 'dirty'
          ? '待保存…'
          : savedAt
            ? `已保存 ${formatClock(savedAt)}`
            : '已保存';

  return (
    <div className="exam-shell">
      <header className="exam-top">
        <div className="exam-top-title">
          <b>{session?.examName || '在线考试'}</b>
          <span>{session?.attemptNo} · 共 {questions.length} 题 · 满分 {formatScore(questions.reduce((sum, q) => sum + (Number(q.fullScore) || 0), 0))}</span>
        </div>

        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          <div className={`save-indicator${saveState === 'saving' ? ' saving' : ''}${saveState === 'error' ? ' error' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {saveLabel}
          </div>
          <Countdown seconds={remaining} dangerAt={300} />
          <Button variant="primary" disabled={submitting || Boolean(result)} onClick={() => setConfirmOpen(true)}>
            交卷
          </Button>
        </div>
      </header>

      {timeoutNotice || elapsedZero ? (
        <div className="alert-bar danger" style={{ margin: '14px auto 0', maxWidth: 1240, width: 'calc(100% - 48px)' }}>
          <div>
            <b>考试时间已结束。</b>
            {session?.autoSubmitOnTimeout
              ? '系统已自动提交答卷，请返回成绩列表查看判分状态。'
              : '系统已锁定作答，请联系监考教师处理。'}
          </div>
        </div>
      ) : null}

      <div className="exam-body">
        <main className="exam-main">
          {currentQuestion ? (
            <div className="question-card">
              <div className="question-head">
                <div className="question-index">
                  <b>{current + 1}</b>
                  <span>/ {questions.length}</span>
                  <span className="muted">·</span>
                  <span>{QUESTION_TYPE_LABEL[currentQuestion.questionType]}</span>
                </div>
                <span className="mono small" style={{ color: 'var(--oe-core-muted)' }}>
                  {formatScore(currentQuestion.fullScore)} 分
                </span>
              </div>

              <p className="question-stem">{currentQuestion.stem}</p>

              {renderAnswerInput(currentQuestion)}

              <div className="exam-nav">
                <Button variant="secondary" disabled={current === 0} onClick={() => goTo(current - 1)}>
                  上一题
                </Button>
                <span className="xs muted" style={{ alignSelf: 'center' }}>
                  {currentQuestion.questionType === 'multiple' ? '多选题：少选按系统配置计分' : '答案将自动暂存'}
                </span>
                {current + 1 < questions.length ? (
                  <Button variant="primary" onClick={() => goTo(current + 1)}>下一题</Button>
                ) : (
                  <Button variant="primary" onClick={() => setConfirmOpen(true)}>检查并交卷</Button>
                )}
              </div>
            </div>
          ) : (
            <div className="card card-pad">
              <p className="muted">本题题目数据为空，请刷新页面恢复答卷。</p>
            </div>
          )}
        </main>

        <aside className="answer-sheet">
          <div className="answer-sheet-head">
            <b>答题卡</b>
            <span>{questions.length - unanswered.length} / {questions.length}</span>
          </div>
          <div className="sheet-grid">
            {questions.map((q, index) => {
              const ans = answers[q.questionId];
              const answered = Array.isArray(ans) && ans.length > 0 && ans.some((v) => String(v ?? '').trim() !== '');
              return (
                <button
                  key={q.questionId}
                  type="button"
                  className={`sheet-cell${answered ? ' answered' : ''}${index === current ? ' current' : ''}`}
                  onClick={() => goTo(index)}
                  aria-label={`第 ${index + 1} 题${answered ? '，已作答' : '，未作答'}`}
                  title={`第 ${index + 1} 题${answered ? '（已答）' : '（未答）'}`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          <div className="sheet-legend">
            <span><i className="lg-answered" />已作答</span>
            <span><i className="lg-current" />当前题</span>
            <span><i className="lg-empty" />未作答</span>
          </div>
          <Button className="exam-submit" variant="primary" disabled={submitting || Boolean(result)} onClick={() => setConfirmOpen(true)}>
            提交试卷
          </Button>
          <p className="xs muted mt-3" style={{ lineHeight: 1.7 }}>
            剩余 {unanswered.length} 题未作答。交卷后无法修改答案，请确认后再提交。
          </p>
        </aside>
      </div>

      {/* 交卷二次确认 */}
      <Modal
        open={confirmOpen}
        title="确认交卷"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>继续作答</Button>
            <Button variant="primary" loading={submitting} onClick={() => doSubmit('manual')}>确认交卷</Button>
          </>
        }
      >
        <p style={{ lineHeight: 1.8 }}>
          本卷共 <b>{questions.length}</b> 题，尚有{' '}
          <b style={{ color: unanswered.length ? 'var(--oe-danger-ink)' : 'var(--oe-success-ink)' }}>{unanswered.length}</b> 题未作答。
        </p>
        {unanswered.length ? (
          <div className="alert-bar" style={{ marginTop: 10 }}>
            <div>
              未作答题目：{unanswered.map(({ index }) => `第 ${index + 1} 题`).join('、')}
            </div>
          </div>
        ) : (
          <div className="alert-bar info" style={{ marginTop: 10 }}>所有题目均已作答。</div>
        )}
        <div className="alert-bar danger" style={{ marginTop: 10 }}>
          交卷后答卷固化并立即触发自动判分，无法再次修改。客观题将即时出分，主观题需教师人工阅卷。
        </div>
      </Modal>

      {/* 交卷结果 */}
      <Modal
        open={Boolean(result)}
        title={result?.submitType === 'timeout' ? '已自动交卷' : '交卷成功'}
        onClose={() => navigate('/student/results')}
        footer={
          <>
            <Button variant="secondary" onClick={() => navigate('/student/exams')}>返回考试列表</Button>
            <Button variant="primary" onClick={() => navigate('/student/results')}>查看我的成绩</Button>
          </>
        }
      >
        {result ? (
          <>
            <div className="detail-grid">
              <div className="detail-item"><span>答卷编号</span><b className="mono">{result.attemptNo || session?.attemptNo}</b></div>
              <div className="detail-item"><span>交卷方式</span><b>{result.submitType === 'timeout' ? '超时自动交卷' : result.submitType === 'force' ? '强制交卷' : '手动交卷'}</b></div>
              <div className="detail-item"><span>客观题得分</span><b className="mono">{formatScore(result.objectiveScore)}</b></div>
              <div className="detail-item"><span>主观题得分</span><b className="mono">{formatScore(result.subjectiveScore)}</b></div>
              <div className="detail-item"><span>当前总分</span><b className="mono">{formatScore(result.totalScore)}</b></div>
              <div className="detail-item"><span>判分状态</span><b>{result.gradingStatus === 'manual_pending' ? `待人工阅卷（${result.pendingManualCount ?? 0} 题）` : '已完成'}</b></div>
            </div>
            <div className="alert-bar info" style={{ marginTop: 12 }}>
              {result.pendingManualCount
                ? `本卷含 ${result.pendingManualCount} 道主观题，需教师人工阅卷。成绩发布前学生端显示「评阅中」。`
                : '客观题已完成自动判分，最终成绩以教师发布为准。'}
              {result.replayed ? '（本次为幂等重放，结果与首次交卷一致）' : ''}
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}