import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePaginated } from '../../hooks/usePaginated.js';
import {
  createQuestionBank,
  deleteQuestion,
  deleteQuestionBank,
  exportQuestions,
  importQuestions,
  listQuestionBanks,
  listQuestions,
  updateQuestionBank,
} from '../../api/questions.js';
import { listKnowledgePoints } from '../../api/knowledge.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Pagination from '../../components/Pagination.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Modal from '../../components/Modal.jsx';
import { FormField, Input, Select, Textarea } from '../../components/Form.jsx';
import { formatDateTime, formatScore, truncate, downloadBlob } from '../../utils/format.js';
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_TAG,
  DIFFICULTY_LABEL,
  QUESTION_STATUS_LABEL,
  QUESTION_STATUS_TAG,
} from '../../utils/enums.js';
import { maxLen, numberRange, required, runRules } from '../../utils/validate.js';

/**
 * 题库与题目管理（REQ-QBM-01 ~ 06）
 * 契约：/question-banks（CRUD + 授权）、/questions（检索/删除）、
 *      /questions/import（multipart）、/questions/export（Excel）
 */
export default function QuestionBank() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('questions');

  // ---------------- 题库 ----------------
  const banks = usePaginated(listQuestionBanks, { initialFilters: { keyword: '' }, pageSize: 50 });
  const [bankModal, setBankModal] = useState(null); // { mode, bank }
  const [bankForm, setBankForm] = useState({ bankName: '', bankCode: '', description: '', visibility: 'private' });
  const [bankErrs, setBankErrs] = useState({});
  const [bankKeyword, setBankKeyword] = useState('');
  const [busy, setBusy] = useState(false);

  // ---------------- 题目 ----------------
  const [filters, setFilters] = useState({ keyword: '', bankId: '', questionType: '', difficulty: '', status: '' });
  const questions = usePaginated(listQuestions, { initialFilters: {}, pageSize: 20 });
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [references, setReferences] = useState(null); // 删除保护返回的引用清单
  const [importModal, setImportModal] = useState(false);
  const [importForm, setImportForm] = useState({ file: null, bankId: '', knowledgePointId: '', defaultScore: '' });
  const [importResult, setImportResult] = useState(null);
  const [importErrs, setImportErrs] = useState({});

  useEffect(() => {
    listKnowledgePoints({})
      .then((list) => setKnowledgePoints(Array.isArray(list) ? list : []))
      .catch(() => setKnowledgePoints([]));
  }, []);

  const bankOptions = banks.list.map((b) => ({ id: b.id, name: b.bankName }));

  // ---------------- 题库操作 ----------------
  const openBank = (mode, bank = null) => {
    setBankErrs({});
    setBankForm(
      bank
        ? { bankName: bank.bankName, bankCode: bank.bankCode || '', description: bank.description || '', visibility: bank.visibility || 'private' }
        : { bankName: '', bankCode: '', description: '', visibility: 'private' },
    );
    setBankModal({ mode, bank });
  };

  const saveBank = async () => {
    const result = runRules(bankForm, {
      bankName: [(v) => required(v, '题库名称'), (v) => maxLen(v, 128, '题库名称')],
      bankCode: [(v) => maxLen(v, 32, '题库编码')],
      description: [(v) => maxLen(v, 500, '说明')],
    });
    setBankErrs(result.errors);
    if (!result.valid) return;
    setBusy(true);
    try {
      const payload = {
        bankName: bankForm.bankName.trim(),
        visibility: bankForm.visibility,
        ...(bankForm.bankCode ? { bankCode: bankForm.bankCode.trim() } : {}),
        ...(bankForm.description ? { description: bankForm.description.trim() } : {}),
      };
      if (bankModal.mode === 'create') {
        await createQuestionBank(payload);
        toast.success('题库已创建');
      } else {
        await updateQuestionBank(bankModal.bank.id, payload);
        toast.success('题库已更新');
      }
      setBankModal(null);
      banks.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const removeBank = async (bank) => {
    if (!window.confirm(`确认删除题库「${bank.bankName}」？题库内仍有题目或被引用时将拒绝删除。`)) return;
    try {
      await deleteQuestionBank(bank.id);
      toast.success('题库已删除（软删除）');
      banks.reload();
    } catch (err) {
      toast.error(err?.displayMessage || '删除失败');
    }
  };

  // ---------------- 题目操作 ----------------
  const applyQuestionFilter = () => {
    questions.setFilters({ ...filters });
  };

  const removeQuestion = async (question) => {
    if (!window.confirm(`确认删除题目「${truncate(question.stem, 30)}」？`)) return;
    try {
      await deleteQuestion(question.id);
      toast.success('题目已删除（软删除）');
      questions.reload();
    } catch (err) {
      if (err?.status === 409) {
        setReferences(err.data || { questionId: question.id });
      } else {
        toast.error(err?.displayMessage || '删除失败');
      }
    }
  };

  const handleExport = async () => {
    try {
      const blob = await exportQuestions({
        ...(filters.bankId ? { bankId: filters.bankId } : {}),
        ...(filters.questionType ? { questionType: filters.questionType } : {}),
      });
      downloadBlob(blob, `questions-${Date.now()}.xlsx`);
      toast.success('题库导出已开始下载');
    } catch (err) {
      toast.error(err?.displayMessage || '导出失败');
    }
  };

  const submitImport = async () => {
    if (!importForm.file) {
      setImportErrs({ file: '请选择 .xlsx 或 .csv 文件' });
      return;
    }
    if (!importForm.bankId) {
      setImportErrs({ bankId: '请选择目标题库' });
      return;
    }
    const scoreMsg = importForm.defaultScore === '' ? null : numberRange(importForm.defaultScore, 0.5, 100, '默认分值');
    if (scoreMsg) {
      setImportErrs({ defaultScore: scoreMsg });
      return;
    }
    setBusy(true);
    setImportErrs({});
    try {
      const result = await importQuestions({
        file: importForm.file,
        bankId: importForm.bankId,
        knowledgePointId: importForm.knowledgePointId,
        defaultScore: importForm.defaultScore,
      });
      setImportResult(result);
      questions.reload();
      banks.reload();
      toast.success(`导入完成：成功 ${result?.successCount ?? 0} 条，失败 ${result?.failureCount ?? 0} 条`);
    } catch (err) {
      toast.error(err?.displayMessage || '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const questionColumns = [
    {
      key: 'stem',
      title: '题干',
      render: (q) => (
        <div style={{ maxWidth: 380 }}>
          <div className="small" style={{ fontWeight: 550 }}>{truncate(q.stem, 68)}</div>
          <div className="xs muted mono">{q.questionNo} · {q.bankName}</div>
        </div>
      ),
    },
    {
      key: 'questionType',
      title: '题型',
      render: (q) => <Tag tone={QUESTION_TYPE_TAG[q.questionType]?.replace('tag-', '') || 'neutral'}>{QUESTION_TYPE_LABEL[q.questionType] || q.questionType}</Tag>,
    },
    { key: 'difficulty', title: '难度', render: (q) => <span className="small">{q.difficulty} · {DIFFICULTY_LABEL[q.difficulty]}</span> },
    { key: 'knowledgePointName', title: '知识点', render: (q) => <span className="small">{q.knowledgePointName || '—'}</span> },
    { key: 'defaultScore', title: '分值', render: (q) => <span className="mono">{formatScore(q.defaultScore)}</span> },
    { key: 'referenceCount', title: '引用', render: (q) => <span className="mono">{q.referenceCount ?? 0}</span> },
    {
      key: 'status',
      title: '状态',
      render: (q) => <Tag tone={QUESTION_STATUS_TAG[q.status]?.replace('tag-', '') || 'neutral'}>{QUESTION_STATUS_LABEL[q.status] || q.status}</Tag>,
    },
    {
      key: 'actions',
      title: '操作',
      render: (q) => (
        <div className="cell-actions">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/teacher/questions/${q.id}/edit`)}>编辑</Button>
          <Button size="sm" variant="ghost" onClick={() => removeQuestion(q)}>删除</Button>
        </div>
      ),
    },
  ];

  const bankColumns = [
    {
      key: 'bankName',
      title: '题库',
      render: (b) => (
        <div>
          <div className="strong">{b.bankName}</div>
          <div className="xs muted mono">{b.bankCode}</div>
        </div>
      ),
    },
    { key: 'ownerName', title: '所有者', render: (b) => b.ownerName || '—' },
    { key: 'visibility', title: '可见性', render: (b) => (b.visibility === 'shared' ? <Tag tone="cyan">共享</Tag> : <Tag>私有</Tag>) },
    { key: 'questionCount', title: '题目数', render: (b) => <span className="mono">{b.questionCount ?? 0}</span> },
    { key: 'description', title: '说明', render: (b) => <span className="small muted">{truncate(b.description || '—', 44)}</span> },
    { key: 'createdAt', title: '创建时间', render: (b) => <span className="mono xs">{formatDateTime(b.createdAt)}</span> },
    {
      key: 'actions',
      title: '操作',
      render: (b) => (
        <div className="cell-actions">
          <Button size="sm" variant="ghost" onClick={() => openBank('edit', b)}>编辑</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTab('questions');
              setFilters({ keyword: '', bankId: b.id, questionType: '', difficulty: '', status: '' });
              questions.setFilters({ bankId: b.id });
            }}
          >
            查看题目
          </Button>
          <Button size="sm" variant="ghost" onClick={() => removeBank(b)}>删除</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="题库与题目"
        desc="按题型、难度、知识点组织题目。被未归档试卷或进行中考试引用的题目无法删除，删除时返回引用清单。"
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportModal(true)}>批量导入</Button>
            <Button variant="secondary" onClick={handleExport}>导出 Excel</Button>
            <Button variant="primary" onClick={() => navigate('/teacher/questions/new')}>+ 新建题目</Button>
          </>
        }
      />

      <div className="row gap-2" style={{ marginBottom: 14 }}>
        <button type="button" className={`btn btn-sm ${tab === 'questions' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('questions')}>
          题目（{questions.total}）
        </button>
        <button type="button" className={`btn btn-sm ${tab === 'banks' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('banks')}>
          题库（{banks.total}）
        </button>
      </div>

      {tab === 'questions' ? (
        <>
          <div className="toolbar">
            <div className="toolbar-item grow">
              <span>关键词</span>
              <Input placeholder="题干关键词 / 题目编号" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && applyQuestionFilter()} />
            </div>
            <div className="toolbar-item">
              <span>题库</span>
              <Select value={filters.bankId} onChange={(e) => setFilters({ ...filters, bankId: e.target.value })}>
                <option value="">全部题库</option>
                {bankOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
            <div className="toolbar-item">
              <span>题型</span>
              <Select value={filters.questionType} onChange={(e) => setFilters({ ...filters, questionType: e.target.value })}>
                <option value="">全部题型</option>
                {Object.entries(QUESTION_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div className="toolbar-item" style={{ minWidth: 100 }}>
              <span>难度</span>
              <Select value={filters.difficulty} onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}>
                <option value="">全部</option>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </div>
            <div className="toolbar-item">
              <span>状态</span>
              <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">全部状态</option>
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
                <option value="archived">已归档</option>
              </Select>
            </div>
            <div className="toolbar-actions">
              <Button variant="primary" size="sm" onClick={applyQuestionFilter}>查询</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const empty = { keyword: '', bankId: '', questionType: '', difficulty: '', status: '' };
                  setFilters(empty);
                  questions.resetFilters({});
                }}
              >
                重置
              </Button>
            </div>
          </div>

          <div className="list-card">
            <Table
              columns={questionColumns}
              rows={questions.list}
              loading={questions.loading}
              error={questions.error}
              onRetry={questions.reload}
              emptyTitle="没有符合条件的题目"
              emptyDesc="调整筛选条件，或新建题目 / 批量导入。"
            />
            <Pagination page={questions.page} pageSize={questions.pageSize} total={questions.total} onChange={questions.setPage} onPageSizeChange={questions.setPageSize} />
          </div>
        </>
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-item grow">
              <span>题库关键词</span>
              <Input placeholder="题库名称 / 编码" value={bankKeyword} onChange={(e) => setBankKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && banks.setFilters({ keyword: bankKeyword })} />
            </div>
            <div className="toolbar-actions">
              <Button variant="primary" size="sm" onClick={() => banks.setFilters({ keyword: bankKeyword })}>查询</Button>
              <Button variant="secondary" size="sm" onClick={() => openBank('create')}>+ 新建题库</Button>
            </div>
          </div>

          <div className="list-card">
            <Table
              columns={bankColumns}
              rows={banks.list}
              loading={banks.loading}
              error={banks.error}
              onRetry={banks.reload}
              emptyTitle="暂无题库"
              emptyDesc="先创建一个题库，再向其中添加题目。"
            />
            <Pagination page={banks.page} pageSize={banks.pageSize} total={banks.total} onChange={banks.setPage} onPageSizeChange={banks.setPageSize} />
          </div>
        </>
      )}

      {/* 题库弹窗 */}
      <Modal
        open={Boolean(bankModal)}
        title={bankModal?.mode === 'create' ? '新建题库' : '编辑题库'}
        onClose={() => setBankModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBankModal(null)}>取消</Button>
            <Button variant="primary" loading={busy} onClick={saveBank}>保存</Button>
          </>
        }
      >
        <div className="form-grid-2">
          <FormField label="题库名称" required error={bankErrs.bankName}>
            {(f) => <Input id={f.id} invalid={f.invalid} value={bankForm.bankName} onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })} />}
          </FormField>
          <FormField label="题库编码" error={bankErrs.bankCode} hint="留空由服务端生成">
            {(f) => <Input id={f.id} invalid={f.invalid} value={bankForm.bankCode} onChange={(e) => setBankForm({ ...bankForm, bankCode: e.target.value })} />}
          </FormField>
        </div>
        <FormField label="可见性">
          {(f) => (
            <Select id={f.id} value={bankForm.visibility} onChange={(e) => setBankForm({ ...bankForm, visibility: e.target.value })}>
              <option value="private">私有（仅本人）</option>
              <option value="shared">共享（可授权其他教师）</option>
            </Select>
          )}
        </FormField>
        <FormField label="说明" error={bankErrs.description}>
          {(f) => <Textarea id={f.id} rows={2} invalid={f.invalid} value={bankForm.description} onChange={(e) => setBankForm({ ...bankForm, description: e.target.value })} />}
        </FormField>
      </Modal>

      {/* 删除保护引用清单 */}
      <Modal
        open={Boolean(references)}
        title="题目无法删除：已被引用"
        onClose={() => setReferences(null)}
        footer={<Button variant="secondary" onClick={() => setReferences(null)}>知道了</Button>}
      >
        <p className="small" style={{ lineHeight: 1.8, marginBottom: 12 }}>
          该题目被以下未归档试卷或进行中考试引用，请先从相应载体中移除，或改为归档题目。
        </p>
        <h4 className="small strong">引用试卷</h4>
        {(references?.papers || []).length ? (
          <ul className="small" style={{ margin: '6px 0 12px', lineHeight: 1.9 }}>
            {references.papers.map((p) => (
              <li key={p.paperId}>· {p.paperName}（{p.status}）</li>
            ))}
          </ul>
        ) : <div className="xs muted" style={{ marginBottom: 12 }}>无</div>}
        <h4 className="small strong">引用考试</h4>
        {(references?.exams || []).length ? (
          <ul className="small" style={{ margin: '6px 0', lineHeight: 1.9 }}>
            {references.exams.map((e) => (
              <li key={e.examId}>· {e.examName}（{e.status}）</li>
            ))}
          </ul>
        ) : <div className="xs muted">无</div>}
      </Modal>

      {/* 批量导入 */}
      <Modal
        open={importModal}
        title="批量导入题目"
        onClose={() => {
          setImportModal(false);
          setImportResult(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setImportModal(false);
                setImportResult(null);
              }}
            >
              关闭
            </Button>
            <Button variant="primary" loading={busy} onClick={submitImport}>开始导入</Button>
          </>
        }
      >
        <FormField label="文件" required error={importErrs.file} hint="支持 .xlsx / .csv，单文件不超过 5000 行">
          {(f) => (
            <input
              id={f.id}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="input"
              onChange={(e) => setImportForm({ ...importForm, file: e.target.files?.[0] || null })}
            />
          )}
        </FormField>
        <div className="form-grid-2">
          <FormField label="目标题库" required error={importErrs.bankId}>
            {(f) => (
              <Select id={f.id} value={importForm.bankId} onChange={(e) => setImportForm({ ...importForm, bankId: e.target.value })}>
                <option value="">请选择</option>
                {bankOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="默认知识点">
            {(f) => (
              <Select id={f.id} value={importForm.knowledgePointId} onChange={(e) => setImportForm({ ...importForm, knowledgePointId: e.target.value })}>
                <option value="">不指定</option>
                {knowledgePoints.map((kp) => <option key={kp.id} value={kp.id}>{kp.kpName}</option>)}
              </Select>
            )}
          </FormField>
        </div>
        <FormField label="默认分值" error={importErrs.defaultScore} hint="文件中未指定分值时使用">
          {(f) => <Input id={f.id} type="number" min="0.5" step="0.5" invalid={Boolean(importErrs.defaultScore)} value={importForm.defaultScore} onChange={(e) => setImportForm({ ...importForm, defaultScore: e.target.value })} />}
        </FormField>

        {importResult ? (
          <div style={{ marginTop: 14 }}>
            <div className="alert-bar info">
              总行数 {importResult.totalRows ?? 0}，成功 {importResult.successCount ?? 0}，失败 {importResult.failureCount ?? 0}
            </div>
            {(importResult.failures || []).length ? (
              <div className="table-wrap" style={{ marginTop: 10, maxHeight: 220 }}>
                <table className="data-table">
                  <thead><tr><th>行号</th><th>失败原因</th></tr></thead>
                  <tbody>
                    {importResult.failures.map((f) => (
                      <tr key={`${f.rowNo}-${f.reason}`}><td className="mono">{f.rowNo}</td><td className="small">{f.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}