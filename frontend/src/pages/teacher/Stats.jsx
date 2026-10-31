import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch.js';
import { usePaginated } from '../../hooks/usePaginated.js';
import { listExams } from '../../api/exams.js';
import {
  exportExamScores,
  getExamStatistics,
  getKnowledgePointStatistics,
  getQuestionAnalysis,
  listExamScores,
  publishScores,
} from '../../api/stats.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Empty from '../../components/Empty.jsx';
import BarChart from '../../components/BarChart.jsx';
import Pagination from '../../components/Pagination.jsx';
import Table from '../../components/Table.jsx';
import { Select, Input } from '../../components/Form.jsx';
import { downloadBlob, formatDateTime, formatScore, formatPercent } from '../../utils/format.js';
import { QUESTION_TYPE_LABEL, SCORE_STATUS_LABEL } from '../../utils/enums.js';

/**
 * 成绩统计（REQ-STA-02/03/04/05/06）
 * 契约：GET /exams/{id}/statistics、/question-analysis、/statistics/knowledge-points、
 *      GET /exams/{id}/scores、GET /exams/{id}/scores/export、POST /exams/{id}/publish-scores
 * 图表使用原生 SVG 自绘（零图表依赖）。
 *
 * 统计口径：平均分/最高/最低/标准差按已交卷且已判分答卷计算；
 * 应考人数来自考试任务总数，缺考 = 应考 - 已交卷（页面明示口径）。
 */
export default function TeacherStats() {
  const [search, setSearch] = useSearchParams();
  const initialId = search.get('examId') || '';
  const [examId, setExamId] = useState(initialId);
  const [exams, setExams] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [sortBy, setSortBy] = useState('totalScore');
  const [order, setOrder] = useState('desc');
  const [classFilter, setClassFilter] = useState('');

  useEffect(() => {
    listExams({ page: 1, pageSize: 100 })
      .then((page) => {
        const list = page?.list || [];
        setExams(list);
        if (!initialId && list.length) {
          setExamId(String(list[0].id));
          setSearch({ examId: String(list[0].id) }, { replace: true });
        }
      })
      .catch(() => setExams([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statistics = useFetch(() => (examId ? getExamStatistics(examId) : Promise.resolve(null)), [examId], {
    immediate: Boolean(examId),
    initialData: null,
  });
  const analysis = useFetch(() => (examId ? getQuestionAnalysis(examId) : Promise.resolve(null)), [examId], {
    immediate: Boolean(examId),
    initialData: null,
  });
  const kpStats = useFetch(
    () => (examId ? getKnowledgePointStatistics(examId) : Promise.resolve([])),
    [examId],
    { immediate: Boolean(examId), initialData: [] },
  );

  const scores = usePaginated(
    ({ examId: id, page, pageSize, sortBy: sort, order: dir, classId }) =>
      id ? listExamScores(id, { page, pageSize, sortBy: sort, order: dir, ...(classId ? { classId } : {}) }) : Promise.resolve({ list: [], total: 0 }),
    {
      initialFilters: { examId: initialId, sortBy: 'totalScore', order: 'desc', classId: '' },
      pageSize: 20,
    },
  );

  const changeExam = (id) => {
    setExamId(id);
    setSearch({ examId: id }, { replace: true });
  };

  // 考试切换后同步成绩列表筛选（列表 fetcher 依赖 examId）
  useEffect(() => {
    if (examId) {
      scores.setFilters({ examId, sortBy, order, classId: classFilter });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  const chartData = useMemo(
    () =>
      (statistics.data?.scoreDistribution || []).map((item) => ({
        label: item.range,
        value: item.count,
      })),
    [statistics.data],
  );

  const currentExam = exams.find((e) => String(e.id) === String(examId));

  const handlePublish = async () => {
    if (!examId) return;
    if (!window.confirm('确认发布本场考试成绩？发布后学生即可查看具体分数，且不可重复发布。')) return;
    setPublishing(true);
    try {
      const result = await publishScores(examId);
      toast.success(`成绩已发布，通知 ${result?.notifiedCount ?? 0} 名学生`);
      statistics.reload(true);
      scores.reload();
      listExams({ page: 1, pageSize: 100 }).then((page) => setExams(page?.list || [])).catch(() => {});
    } catch (err) {
      toast.error(err?.displayMessage || '成绩发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleExport = async () => {
    if (!examId) return;
    setExporting(true);
    try {
      const blob = await exportExamScores(examId, classFilter ? { classId: classFilter } : {});
      downloadBlob(blob, `exam-${examId}-scores-${Date.now()}.xlsx`);
      toast.success('成绩表已开始下载（导出行为已写入审计日志）');
    } catch (err) {
      toast.error(err?.displayMessage || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const scoreColumns = [
    { key: 'classRank', title: '排名', render: (s) => <span className="mono">{s.classRank ?? '—'}</span> },
    {
      key: 'student',
      title: '学生',
      render: (s) => (
        <div>
          <div className="strong small">{s.studentName}</div>
          <div className="xs muted mono">{s.studentNo} · {s.className || '—'}</div>
        </div>
      ),
    },
    { key: 'totalScore', title: '总分', render: (s) => <b className="mono">{formatScore(s.totalScore, '评阅中')}</b> },
    { key: 'objectiveScore', title: '客观题', render: (s) => <span className="mono">{formatScore(s.objectiveScore)}</span> },
    { key: 'subjectiveScore', title: '主观题', render: (s) => <span className="mono">{formatScore(s.subjectiveScore)}</span> },
    {
      key: 'isPassed',
      title: '是否及格',
      render: (s) =>
        s.isPassed === null || s.isPassed === undefined ? (
          <Tag tone="amber">待判分</Tag>
        ) : s.isPassed ? (
          <Tag tone="green">及格</Tag>
        ) : (
          <Tag tone="red">不及格</Tag>
        ),
    },
    { key: 'submittedAt', title: '交卷时间', render: (s) => <span className="mono xs">{formatDateTime(s.submittedAt)}</span> },
  ];

  const questionColumns = [
    { key: 'questionNo', title: '题号', render: (q) => <span className="mono xs">{q.questionNo || q.questionId}</span> },
    { key: 'questionType', title: '题型', render: (q) => <span className="small">{QUESTION_TYPE_LABEL[q.questionType] || q.questionType}</span> },
    {
      key: 'stem',
      title: '题干',
      render: (q) => <span className="small" style={{ display: 'inline-block', maxWidth: 320 }}>{q.stem}</span>,
    },
    // 后端比例字段（submitRate / passRate / excellentRate / correctRate / lostRate）
    // 统一返回 0~100 的百分数（见 backend stat.model.js），前端不再二次乘 100
    { key: 'correctRate', title: '正确率', render: (q) => <span className="mono">{formatPercent(q.correctRate ?? 0)}</span> },
    { key: 'avgScoreRate', title: '平均得分率', render: (q) => <span className="mono">{formatPercent(q.avgScoreRate ?? 0)}</span> },
    { key: 'difficultyIndex', title: '难度系数', render: (q) => <span className="mono">{formatScore(q.difficultyIndex)}</span> },
    { key: 'discriminationIndex', title: '区分度', render: (q) => <span className="mono">{formatScore(q.discriminationIndex)}</span> },
    {
      key: 'isAbnormal',
      title: '质量标记',
      render: (q) =>
        q.isAbnormal ? (
          <Tag tone="red" title={q.abnormalReason || '正确率异常'}>{q.abnormalReason ? '异常' : '异常题'}</Tag>
        ) : (
          <Tag tone="green">正常</Tag>
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="成绩统计"
        desc="单场考试统计、题目质量分析与知识点失分分布。统计口径：应考人数取考试任务数，缺考 = 应考 − 已交卷；平均分/标准差按已判分答卷计算。"
        actions={
          <>
            <Select value={examId} onChange={(e) => changeExam(e.target.value)} style={{ width: 260 }}>
              <option value="">请选择考试</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>{e.examName}（{SCORE_STATUS_LABEL[e.scoreStatus]}）</option>
              ))}
            </Select>
            <Button variant="secondary" loading={exporting} disabled={!examId} onClick={handleExport}>导出成绩表</Button>
            <Button
              variant="primary"
              loading={publishing}
              disabled={!examId || currentExam?.scoreStatus === 'published'}
              onClick={handlePublish}
            >
              {currentExam?.scoreStatus === 'published' ? '成绩已发布' : '发布成绩'}
            </Button>
          </>
        }
        meta={
          currentExam ? (
            <>
              <Tag tone="cyan">{currentExam.examNo}</Tag>
              <Tag tone={currentExam.scoreStatus === 'published' ? 'green' : 'amber'}>
                {SCORE_STATUS_LABEL[currentExam.scoreStatus]}
              </Tag>
              <span className="xs muted">
                {formatDateTime(currentExam.startTime)} ~ {formatDateTime(currentExam.endTime)}
              </span>
            </>
          ) : null
        }
      />

      {!examId ? (
        <Empty title="请选择一场考试" desc="选择考试后展示平均分、及格率、分数段分布与题目正确率。" minHeight={320} />
      ) : statistics.loading ? (
        <Loading text="正在计算统计指标…" minHeight={320} />
      ) : statistics.error ? (
        <ErrorState message={statistics.error} onRetry={() => statistics.reload()} />
      ) : statistics.data ? (
        <>
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-label">应考 / 实考</div>
              <div className="metric-value">{statistics.data.participantCount}<small>/ {statistics.data.submittedCount} 人</small></div>
              <div className="metric-foot">缺考 {statistics.data.absentCount} 人 · 交卷率 {formatPercent(statistics.data.submitRate ?? 0)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">平均分</div>
              <div className="metric-value">{formatScore(statistics.data.avgScore)}</div>
              <div className="metric-foot">标准差 {formatScore(statistics.data.stdDev)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">最高 / 最低</div>
              <div className="metric-value">{formatScore(statistics.data.maxScore)}<small>/ {formatScore(statistics.data.minScore)}</small></div>
              <div className="metric-foot">全场极值</div>
            </div>
            <div className="metric">
              <div className="metric-label">及格率</div>
              <div className="metric-value">{formatPercent(statistics.data.passRate ?? 0)}</div>
              <div className="metric-foot">及格 {statistics.data.passCount ?? 0} 人</div>
            </div>
            <div className="metric">
              <div className="metric-label">优秀率</div>
              <div className="metric-value">{formatPercent(statistics.data.excellentRate ?? 0)}</div>
              <div className="metric-foot">优秀 {statistics.data.excellentCount ?? 0} 人</div>
            </div>
          </div>

          <div className="stats-layout">
            <section className="chart-card">
              <div className="chart-head">
                <span className="chart-title">分数段分布</span>
                <span className="chart-legend">
                  <span><i style={{ background: '#7c3aed' }} />人数</span>
                  <span className="xs muted">统计时间 {formatDateTime(statistics.data.calculatedAt)}</span>
                </span>
              </div>
              <BarChart data={chartData} height={260} valueFormatter={(v) => `${v} 人`} emptyText="暂无分数段数据（可能尚未判分）" />
            </section>

            <section className="chart-card">
              <div className="chart-head">
                <span className="chart-title">知识点失分分布</span>
                <span className="xs muted">失分率越高越需重点讲评</span>
              </div>
              {kpStats.loading ? (
                <Loading text="正在计算知识点失分…" minHeight={180} />
              ) : kpStats.error ? (
                <ErrorState message={kpStats.error} onRetry={() => kpStats.reload()} minHeight={180} />
              ) : (kpStats.data || []).length === 0 ? (
                <Empty title="暂无知识点统计" desc="题目关联知识点后即可统计失分分布。" minHeight={180} />
              ) : (
                <div className="col gap-3" style={{ padding: '6px 0' }}>
                  {(kpStats.data || []).slice(0, 8).map((kp) => {
                    const percent = Math.max(0, Math.min(100, kp.lostRate ?? 0));
                    return (
                      <div key={kp.knowledgePointId}>
                        <div className="row-between" style={{ marginBottom: 4 }}>
                          <span className="small">{kp.knowledgePointName}</span>
                          <span className="mono xs">{formatPercent(percent)}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: '#eef2f7', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${percent}%`,
                              height: '100%',
                              borderRadius: 4,
                              background: 'linear-gradient(90deg, #0e7490, #7c3aed)',
                            }}
                          />
                        </div>
                        <div className="xs muted" style={{ marginTop: 3 }}>
                          失分 {formatScore(kp.lostScore)} / 满分 {formatScore(kp.totalScore)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="chart-card" style={{ marginTop: 16 }}>
            <div className="chart-head">
              <span className="chart-title">题目质量分析</span>
              <span className="chart-legend">
                <span className="xs muted">正确率 &lt;30% 或 &gt;95% 标记为异常题（REQ-STA-03）</span>
              </span>
            </div>
            {analysis.loading ? (
              <Loading text="正在计算题目指标…" />
            ) : analysis.error ? (
              <ErrorState message={analysis.error} onRetry={() => analysis.reload()} />
            ) : !analysis.data?.questions?.length ? (
              <Empty title="暂无题目分析数据" desc="完成阅卷后可查看逐题正确率与区分度。" />
            ) : (
              <div className="analysis-table">
                <Table columns={questionColumns} rows={analysis.data.questions} dense rowKey="questionId" />
              </div>
            )}
          </section>

          <section className="list-card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <span className="card-title">考试成绩列表</span>
              <div className="row gap-2">
                <Input
                  type="number"
                  placeholder="班级 ID"
                  style={{ width: 100, height: 32 }}
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                />
                <Select style={{ width: 120, height: 32 }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="totalScore">按总分</option>
                  <option value="submittedAt">按交卷时间</option>
                </Select>
                <Select style={{ width: 90, height: 32 }} value={order} onChange={(e) => setOrder(e.target.value)}>
                  <option value="desc">降序</option>
                  <option value="asc">升序</option>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => scores.setFilters({ examId, sortBy, order, classId: classFilter })}
                >
                  应用
                </Button>
              </div>
            </div>
            <Table
              columns={scoreColumns}
              rows={scores.list}
              loading={scores.loading}
              error={scores.error}
              onRetry={scores.reload}
              rowKey="attemptId"
              emptyTitle="暂无成绩记录"
              emptyDesc="学生交卷并完成阅卷后，成绩将出现在此处。"
            />
            <Pagination page={scores.page} pageSize={scores.pageSize} total={scores.total} onChange={scores.setPage} onPageSizeChange={scores.setPageSize} />
          </section>
        </>
      ) : null}
    </div>
  );
}