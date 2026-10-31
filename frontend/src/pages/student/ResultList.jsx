import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaginated } from '../../hooks/usePaginated.js';
import { exportMyGrades, listMyGrades } from '../../api/stats.js';
import { toast } from '../../store/uiStore.js';
import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Pagination from '../../components/Pagination.jsx';
import Button from '../../components/Button.jsx';
import Tag from '../../components/Tag.jsx';
import { downloadBlob, formatDateTime, formatScore } from '../../utils/format.js';
import { SCORE_STATUS_LABEL, GRADING_STATUS_LABEL } from '../../utils/enums.js';

/**
 * 我的成绩（REQ-STA-01/05）
 * 契约：GET /my/grades（未发布时 totalScore 为 null，展示「评阅中」）
 *      GET /my/grades/export（本人成绩单 Excel）
 */
export default function ResultList() {
  const navigate = useNavigate();
  const grades = usePaginated(listMyGrades, { pageSize: 20 });
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportMyGrades();
      downloadBlob(blob, `my-grades-${Date.now()}.xlsx`);
      toast.success('成绩单已开始下载');
    } catch (err) {
      toast.error(err?.displayMessage || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    {
      key: 'examName',
      title: '考试',
      render: (g) => (
        <div>
          <div className="strong">{g.examName}</div>
          <div className="xs muted mono">答卷 #{g.attemptId}</div>
        </div>
      ),
    },
    { key: 'submittedAt', title: '交卷时间', render: (g) => <span className="mono xs">{formatDateTime(g.submittedAt)}</span> },
    {
      key: 'scoreStatus',
      title: '成绩状态',
      render: (g) => (
        <Tag tone={g.scoreStatus === 'published' ? 'green' : 'amber'}>
          {SCORE_STATUS_LABEL[g.scoreStatus] || g.scoreStatus}
        </Tag>
      ),
    },
    {
      key: 'totalScore',
      title: '总分',
      render: (g) =>
        g.scoreStatus === 'published' ? (
          <b className="mono">{formatScore(g.totalScore)}</b>
        ) : (
          <span className="small muted">评阅中</span>
        ),
    },
    { key: 'objectiveScore', title: '客观题', render: (g) => <span className="mono">{formatScore(g.objectiveScore)}</span> },
    { key: 'subjectiveScore', title: '主观题', render: (g) => <span className="mono">{formatScore(g.subjectiveScore)}</span> },
    {
      key: 'isPassed',
      title: '结果',
      render: (g) =>
        g.isPassed === null || g.isPassed === undefined ? (
          <span className="small muted">—</span>
        ) : g.isPassed ? (
          <Tag tone="green">及格</Tag>
        ) : (
          <Tag tone="red">不及格</Tag>
        ),
    },
    { key: 'classRank', title: '班级排名', render: (g) => <span className="mono">{g.classRank ?? '—'}</span> },
    {
      key: 'gradingStatus',
      title: '判分状态',
      render: (g) => <span className="small muted">{GRADING_STATUS_LABEL[g.gradingStatus] || g.gradingStatus || '—'}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      render: (g) => (
        <Button
          size="sm"
          variant="ghost"
          disabled={g.scoreStatus !== 'published'}
          title={g.scoreStatus !== 'published' ? '成绩尚未发布' : undefined}
          onClick={() => navigate(`/student/results/${g.attemptId}`)}
        >
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="我的成绩"
        desc="成绩发布后可查看总分、客观/主观分项、逐题得分与教师评语；未发布时显示「评阅中」。对成绩有异议可在详情页发起复核申诉。"
        actions={
          <Button variant="secondary" loading={exporting} onClick={handleExport}>
            导出我的成绩单
          </Button>
        }
      />

      <div className="list-card">
        <Table
          columns={columns}
          rows={grades.list}
          rowKey="attemptId"
          loading={grades.loading}
          error={grades.error}
          onRetry={grades.reload}
          emptyTitle="暂无成绩记录"
          emptyDesc="参加并交卷后，成绩记录会出现在此处。"
        />
        <Pagination page={grades.page} pageSize={grades.pageSize} total={grades.total} onChange={grades.setPage} onPageSizeChange={grades.setPageSize} />
      </div>
    </div>
  );
}