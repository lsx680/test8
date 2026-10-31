import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createExam, getExam, publishExam, updateExam } from '../../api/exams.js';
import { listPapers } from '../../api/papers.js';
import { listClasses } from '../../api/users.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Tag from '../../components/Tag.jsx';
import { CheckLine, FormField, Input, Select, Textarea } from '../../components/Form.jsx';
import { fromDateTimeLocal, toDateTimeLocal, formatMinutes, formatScore } from '../../utils/format.js';
import { EXAM_STATUS_LABEL } from '../../utils/enums.js';
import { integerRange, maxLen, numberRange, required, runRules } from '../../utils/validate.js';

const EMPTY = {
  examName: '',
  paperId: '',
  startTime: '',
  endTime: '',
  durationMinutes: 60,
  passScore: 60,
  maxAttempts: 1,
  shuffleQuestions: false,
  antiCheatEnabled: true,
  antiCheatThreshold: 3,
  autoSubmitOnTimeout: true,
  description: '',
  classIds: [],
};

/**
 * 创建 / 编辑考试（REQ-EXM-01、REQ-EXM-10）
 * 契约：POST /exams、GET|PUT /exams/{id}、POST /exams/{id}/publish
 * 约束：结束时间晚于开始时间；答题时长不得超过考试窗口长度。
 *
 * 契约缺口：ExamScope 支持 studentIds，但教师无学生名单查询端点（GET /users 仅管理员），
 *          因此前端参考范围仅支持按班级指定，studentIds 留空。
 */
export default function ExamEdit() {
  const { examId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const isEdit = Boolean(examId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [papers, setPapers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [errs, setErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exam, setExam] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const tasks = [
      listPapers({ page: 1, pageSize: 100 }).catch(() => ({ list: [] })),
      listClasses().catch(() => []),
    ];
    if (isEdit) tasks.push(getExam(examId));
    Promise.all(tasks)
      .then(([paperPage, classList, detail]) => {
        if (!alive) return;
        setPapers(paperPage?.list || []);
        setClasses(Array.isArray(classList) ? classList : []);
        if (detail) {
          setExam(detail);
          setForm({
            examName: detail.examName || '',
            paperId: detail.paperId ?? '',
            startTime: toDateTimeLocal(detail.startTime),
            endTime: toDateTimeLocal(detail.endTime),
            durationMinutes: detail.durationMinutes ?? 60,
            passScore: detail.passScore ?? 60,
            maxAttempts: detail.maxAttempts ?? 1,
            shuffleQuestions: Boolean(detail.shuffleQuestions),
            antiCheatEnabled: Boolean(detail.antiCheatEnabled),
            antiCheatThreshold: detail.antiCheatThreshold ?? 3,
            autoSubmitOnTimeout: Boolean(detail.autoSubmitOnTimeout),
            description: detail.description || '',
            classIds: (detail.scope?.classIds || []).map(String),
          });
        } else {
          const presetPaper = search.get('paperId');
          if (presetPaper) setForm((prev) => ({ ...prev, paperId: presetPaper }));
        }
        setLoading(false);
      })
      .catch((err) => {
        if (alive) {
          setError(err?.displayMessage || '考试加载失败');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [examId, isEdit, search]);

  const selectedPaper = papers.find((p) => String(p.id) === String(form.paperId));
  // 已发布 / 进行中 / 已结束的考试：后端仅允许延期、说明与防作弊配置变更（exam.service.updateExam）
  const lockedFields = isEdit && Boolean(exam) && exam.status !== 'draft';

  const windowMinutes = (() => {
    if (!form.startTime || !form.endTime) return null;
    const start = new Date(form.startTime).getTime();
    const end = new Date(form.endTime).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    return Math.round((end - start) / 60000);
  })();

  const validate = () => {
    const sharedRules = {
      startTime: [(v) => required(v, '开始时间')],
      endTime: [(v) => required(v, '结束时间')],
      antiCheatThreshold: [(v) => integerRange(v, 1, 99, '防作弊阈值')],
    };
    const result = runRules(
      form,
      lockedFields
        ? sharedRules
        : {
            ...sharedRules,
            examName: [(v) => required(v, '考试名称'), (v) => maxLen(v, 128, '考试名称')],
            paperId: [(v) => required(v, '试卷')],
            durationMinutes: [(v) => integerRange(v, 1, 180, '答题时长')],
            passScore: [(v) => numberRange(v, 0, selectedPaper?.totalScore || 1000, '及格线')],
            maxAttempts: [(v) => integerRange(v, 1, 5, '允许次数')],
            classIds: [(v) => (v?.length ? null : '请至少选择一个参考班级')],
          },
    );
    if (!result.errors.startTime && !result.errors.endTime) {
      if (new Date(form.endTime).getTime() <= new Date(form.startTime).getTime()) {
        result.errors.endTime = '结束时间必须晚于开始时间';
      } else if (windowMinutes !== null && Number(form.durationMinutes) > windowMinutes) {
        const msg = `答题时长（${form.durationMinutes} 分钟）不能超过考试窗口（${windowMinutes} 分钟）`;
        if (lockedFields) result.errors.endTime = msg;
        else result.errors.durationMinutes = msg;
      }
    }
    setErrs(result.errors);
    return Object.keys(result.errors).length === 0;
  };

  const buildPayload = () => {
    if (lockedFields) {
      // 严格对齐后端白名单：startTime / endTime / description /
      // antiCheatEnabled / antiCheatThreshold，避免多余字段触发 40111
      return {
        startTime: fromDateTimeLocal(form.startTime),
        endTime: fromDateTimeLocal(form.endTime),
        description: form.description.trim(),
        antiCheatEnabled: form.antiCheatEnabled,
        antiCheatThreshold: Number(form.antiCheatThreshold),
      };
    }
    return {
      examName: form.examName.trim(),
      paperId: Number(form.paperId),
      startTime: fromDateTimeLocal(form.startTime),
      endTime: fromDateTimeLocal(form.endTime),
      durationMinutes: Number(form.durationMinutes),
      passScore: Number(form.passScore),
      maxAttempts: Number(form.maxAttempts),
      shuffleQuestions: form.shuffleQuestions,
      antiCheatEnabled: form.antiCheatEnabled,
      antiCheatThreshold: Number(form.antiCheatThreshold),
      autoSubmitOnTimeout: form.autoSubmitOnTimeout,
      ...(form.description ? { description: form.description.trim() } : {}),
      scope: { classIds: form.classIds.map(Number), studentIds: [] },
    };
  };

  const handleSave = async (andPublish = false) => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await updateExam(examId, buildPayload());
        toast.success(lockedFields ? '考试延期与说明已保存' : '考试已保存');
        if (andPublish && !lockedFields) {
          setPublishing(true);
          const result = await publishExam(examId);
          toast.success(`发布成功：生成 ${result?.taskCount ?? 0} 条考试任务`);
        }
        navigate('/teacher/exams');
      } else {
        const created = await createExam(buildPayload());
        toast.success('考试草稿已创建');
        if (andPublish) {
          setPublishing(true);
          const result = await publishExam(created.id);
          toast.success(`发布成功：生成 ${result?.taskCount ?? 0} 条考试任务，通知 ${result?.notifiedCount ?? 0} 人`);
        }
        navigate('/teacher/exams');
      }
    } catch (err) {
      if (err?.errors?.length) {
        const mapped = {};
        err.errors.forEach((e) => {
          if (e?.field) mapped[e.field] = e.message;
        });
        setErrs(mapped);
      }
      toast.error(err?.displayMessage || '保存失败');
    } finally {
      setSaving(false);
      setPublishing(false);
    }
  };

  if (loading) {
    return <div className="page"><Loading text="正在加载考试配置…" minHeight={360} /></div>;
  }
  if (error) {
    return <div className="page"><ErrorState message={error} onRetry={() => window.location.reload()} /></div>;
  }

  return (
    <div className="page">
      <PageHeader
        title={isEdit ? `编辑考试 · ${exam?.examName || ''}` : '创建考试'}
        desc="考试以服务端时间为唯一基准。发布后按参考范围生成考试任务并通知学生；已发布考试仅允许延期、说明等白名单字段变更。"
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/teacher/exams')}>返回列表</Button>
            {lockedFields ? (
              <Button variant="primary" loading={saving} onClick={() => handleSave(false)}>
                保存延期与说明
              </Button>
            ) : (
              <>
                <Button variant="secondary" loading={saving && !publishing} onClick={() => handleSave(false)}>
                  保存草稿
                </Button>
                <Button variant="primary" loading={saving} onClick={() => handleSave(true)}>
                  {isEdit ? '保存并发布' : '创建并发布'}
                </Button>
              </>
            )}
          </>
        }
        meta={
          isEdit && exam ? (
            <>
              <Tag tone={exam.status === 'published' || exam.status === 'ongoing' ? 'green' : 'neutral'}>
                {EXAM_STATUS_LABEL[exam.status] || exam.status}
              </Tag>
              <Tag tone="violet">{exam.examNo}</Tag>
              <span className="xs muted">成绩状态：{exam.scoreStatus === 'published' ? '已发布' : '评阅中'}</span>
            </>
          ) : null
        }
      />

      {isEdit && exam?.status !== 'draft' ? (
        <div className="alert-bar" style={{ marginBottom: 16 }}>
          该考试已发布。服务端白名单仅允许修改「开始/结束时间、考试说明、防作弊开关与阈值」；
          考试名称、试卷、答题时长、及格线、作答次数与参考范围已锁定（提交多余字段会被拒绝 40111）。
        </div>
      ) : null}

      <div className="form-card">
        <div className="form-section">
          <h2 className="form-section-title">基本信息</h2>
          <div className="form-grid-2">
            <FormField label="考试名称" required error={errs.examName}>
              {(f) => (
                <Input id={f.id} invalid={f.invalid} disabled={lockedFields} value={form.examName} onChange={(e) => setForm({ ...form, examName: e.target.value })} placeholder="如：2026 秋季《数据结构》期末考试" />
              )}
            </FormField>
            <FormField label="关联试卷" required error={errs.paperId} hint={selectedPaper ? `题数 ${selectedPaper.questionCount} · 总分 ${formatScore(selectedPaper.totalScore)}` : '仅可选择已锁定的试卷发布'}>
              {(f) => (
                <Select
                  id={f.id}
                  invalid={f.invalid}
                  value={form.paperId}
                  disabled={lockedFields}
                  onChange={(e) => {
                    const paper = papers.find((p) => String(p.id) === e.target.value);
                    setForm({
                      ...form,
                      paperId: e.target.value,
                      ...(paper ? { passScore: Math.round(Number(paper.totalScore) * 0.6) } : {}),
                    });
                  }}
                >
                  <option value="">请选择试卷</option>
                  {papers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.paperName}（{p.status === 'locked' ? '已锁定' : p.status}）
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <FormField label="考试说明" error={errs.description}>
            {(f) => (
              <Textarea id={f.id} rows={3} invalid={f.invalid} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="考前须知、允许携带的物品、异常处理方式等" />
            )}
          </FormField>
        </div>

        <div className="form-section">
          <h2 className="form-section-title">时间与计分</h2>
          <div className="form-grid-2">
            <FormField label="开始时间" required error={errs.startTime}>
              {(f) => <Input id={f.id} type="datetime-local" invalid={f.invalid} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />}
            </FormField>
            <FormField label="结束时间" required error={errs.endTime}>
              {(f) => <Input id={f.id} type="datetime-local" invalid={f.invalid} value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />}
            </FormField>
            <FormField label="答题时长（分钟）" required error={errs.durationMinutes} hint={windowMinutes ? `考试窗口 ${windowMinutes} 分钟` : '先填写开始与结束时间'}>
              {(f) => <Input id={f.id} type="number" min="1" max="180" invalid={f.invalid} disabled={lockedFields} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />}
            </FormField>
            <FormField label="及格线" required error={errs.passScore} hint={selectedPaper ? `试卷总分 ${formatScore(selectedPaper.totalScore)}` : ''}>
              {(f) => <Input id={f.id} type="number" min="0" step="0.5" invalid={f.invalid} disabled={lockedFields} value={form.passScore} onChange={(e) => setForm({ ...form, passScore: e.target.value })} />}
            </FormField>
            <FormField label="允许作答次数" error={errs.maxAttempts} hint="1~5 次；用尽后需补考授权">
              {(f) => <Input id={f.id} type="number" min="1" max="5" invalid={f.invalid} disabled={lockedFields} value={form.maxAttempts} onChange={(e) => setForm({ ...form, maxAttempts: e.target.value })} />}
            </FormField>
            <FormField label="防作弊阈值" error={errs.antiCheatThreshold} hint="累计事件超过阈值标记答卷异常">
              {(f) => <Input id={f.id} type="number" min="1" max="99" invalid={f.invalid} value={form.antiCheatThreshold} onChange={(e) => setForm({ ...form, antiCheatThreshold: e.target.value })} />}
            </FormField>
          </div>
        </div>

        <div className="form-section">
          <h2 className="form-section-title">参考范围</h2>
          <FormField label="参考班级" required error={errs.classIds}>
            <div className="perm-grid">
              {classes.length === 0 ? (
                <span className="xs muted">班级字典不可用（GET /classes 加载失败或尚无班级）。</span>
              ) : (
                classes.map((c) => (
                  <label className="perm-item" key={c.id}>
                    <input
                      type="checkbox"
                      checked={form.classIds.includes(String(c.id))}
                      disabled={lockedFields}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          classIds: e.target.checked
                            ? [...form.classIds, String(c.id)]
                            : form.classIds.filter((id) => id !== String(c.id)),
                        })
                      }
                    />
                    <span className="small">{c.className}<span className="xs muted">（{c.studentCount ?? 0} 人）</span></span>
                  </label>
                ))
              )}
            </div>
          </FormField>
          <div className="alert-bar info">
            契约的 ExamScope 还支持按学生 ID 指定范围，但当前未向教师提供学生名单查询接口，前端仅支持按班级指定；
            如需为个别学生单独授权，请在考试列表使用「补考授权」。
          </div>
        </div>

        <div className="form-section">
          <h2 className="form-section-title">考试策略</h2>
          <div className="form-grid-2">
            <div>
              <CheckLine label="打乱题目顺序" hint="按学生维度固定顺序" checked={form.shuffleQuestions} disabled={lockedFields} onChange={(e) => setForm({ ...form, shuffleQuestions: e.target.checked })} />
              <CheckLine label="启用防作弊采集" hint="切屏 / 复制粘贴 / 退出全屏" checked={form.antiCheatEnabled} onChange={(e) => setForm({ ...form, antiCheatEnabled: e.target.checked })} />
            </div>
            <div>
              <CheckLine label="超时自动交卷" hint="剩余时间为 0 时由服务端交卷" checked={form.autoSubmitOnTimeout} disabled={lockedFields} onChange={(e) => setForm({ ...form, autoSubmitOnTimeout: e.target.checked })} />
              <div className="small muted" style={{ marginTop: 6, lineHeight: 1.7 }}>
                当前配置：{formatMinutes(form.durationMinutes)} · 及格 {formatScore(form.passScore)} 分 · 最多 {form.maxAttempts} 次
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions">
          {lockedFields ? (
            <Button variant="primary" loading={saving} onClick={() => handleSave(false)}>
              保存延期与说明
            </Button>
          ) : (
            <>
              <Button variant="primary" loading={saving} onClick={() => handleSave(true)}>
                {isEdit ? '保存并发布' : '创建并发布'}
              </Button>
              <Button variant="secondary" loading={saving && !publishing} onClick={() => handleSave(false)}>仅保存草稿</Button>
            </>
          )}
          <Button variant="ghost" onClick={() => navigate('/teacher/exams')}>取消</Button>
          {errs && Object.keys(errs).length ? (
            <span className="xs" style={{ color: 'var(--oe-danger-ink)' }}>存在 {Object.keys(errs).length} 处校验错误</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}