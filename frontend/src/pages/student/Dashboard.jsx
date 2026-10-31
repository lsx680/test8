import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';
import { listAvailableExams } from '../../api/exams.js';
import { listMyGrades } from '../../api/stats.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatCard from '../../components/StatCard.jsx';
import Loading from '../../components/Loading.jsx';
import Tag from '../../components/Tag.jsx';
import { formatDateTime, formatMinutes, formatScore } from '../../utils/format.js';
import { EXAM_STATUS_LABEL, SCORE_STATUS_LABEL } from '../../utils/enums.js';

/**
 * 学生工作台
 * 数据：GET /exams/available（本人可参加）、GET /my/grades（本人成绩）
 */
export default function StudentDashboard() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState({
    loading: true,
    failed: [],
    exams: { total: 0, list: [] },
    grades: { total: 0, list: [] },
  });

  useEffect(() => {
    let alive = true;
    const settle = (p) =>
      p
        .then((d) => (d === null || d === undefined ? { ok: false } : { ok: true, d }))
        .catch(() => ({ ok: false }));
    Promise.all([
      settle(listAvailableExams({ page: 1, pageSize: 4 })),
      settle(listMyGrades({ page: 1, pageSize: 4 })),
    ]).then(([exams, grades]) => {
      if (!alive) return;
      const failed = [];
      if (!exams.ok) failed.push('可参加考试');
      if (!grades.ok) failed.push('我的成绩');
      setState({
        loading: false,
        failed,
        exams: exams.ok ? { total: exams.d?.total || 0, list: exams.d?.list || [] } : { total: 0, list: [] },
        grades: grades.ok ? { total: grades.d?.total || 0, list: grades.d?.list || [] } : { total: 0, list: [] },
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const published = state.grades.list.filter((g) => g.scoreStatus === 'published').length;

  return (
    <div className="page-cyber">
      <PageHeader
        className="on-dark"
        title={`你好，${user?.realName || '同学'}`}
        desc="查看可参加的考试、进入在线答题、查询成绩并发起复核申诉。答题过程中答案每 3 秒自动暂存，断线重连不会丢失。"
        actions={
          <Link to="/student/exams" className="btn btn-primary">
            查看我的考试
          </Link>
        }
      />

      <div className="hero">
        <div className="hero-eyebrow">
          <span className="pulse" aria-hidden="true" />
          STUDENT TERMINAL · 学生考试终端
        </div>
        <h2 className="hero-title">
          我的考试空间 <span className="neon-text">/ 成绩档案</span>
        </h2>
        <p className="hero-desc">
          系统以服务端时间为唯一计时基准，本地倒计时仅用于展示。交卷后客观题立即判分，
          简答题需教师人工阅卷；成绩发布后可查看逐题得分与评语。
        </p>
        <div className="hero-meta">
          <div>
            <span>可参加考试</span>
            <b>{state.exams.total}</b>
          </div>
          <div>
            <span>成绩记录</span>
            <b>{state.grades.total}</b>
          </div>
          <div>
            <span>班级</span>
            <b>{user?.className || '—'}</b>
          </div>
          <div>
            <span>学号</span>
            <b>{user?.username || '—'}</b>
          </div>
        </div>
      </div>

      {state.loading ? (
        <div className="panel-dark">
          <Loading text="正在加载考试与成绩…" />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="待参加考试" value={state.exams.total} unit="场" tone="cyan" hint="在考试窗口内可进入" />
            <StatCard label="成绩记录" value={state.grades.total} unit="条" tone="violet" hint="含评阅中的答卷" />
            <StatCard label="已发布成绩" value={published} unit="条" tone="green" hint="可查看逐题得分" />
            <StatCard label="待复核" value="—" tone="magenta" hint="可在成绩详情中发起申诉" />
          </div>

          <div className="dash-grid">
            <section className="panel-dark">
              <div className="panel-dark-head">
                <h3>可参加的考试</h3>
                <Link to="/student/exams" className="dash-link">全部 →</Link>
              </div>
              <div className="panel-dark-body">
                {state.exams.list.length === 0 ? (
                  <div className="dash-empty">当前没有可参加的考试</div>
                ) : (
                  <div className="dash-list">
                    {state.exams.list.map((exam) => (
                      <div className="dash-list-item" key={exam.id}>
                        <div className="li-main">
                          <div className="li-title">{exam.examName}</div>
                          <div className="li-meta">
                            {formatDateTime(exam.startTime)} → {formatDateTime(exam.endTime)} · {formatMinutes(exam.durationMinutes)}
                          </div>
                        </div>
                        <div className="row gap-2" style={{ flex: 'none' }}>
                          <span className={`tag tag-dark ${exam.status === 'ongoing' ? 'cyan' : ''}`}>
                            {EXAM_STATUS_LABEL[exam.status] || exam.status}
                          </span>
                          <Link to="/student/exams" className="dash-link">进入</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel-dark">
              <div className="panel-dark-head">
                <h3>最近成绩</h3>
                <Link to="/student/results" className="dash-link">全部 →</Link>
              </div>
              <div className="panel-dark-body">
                {state.grades.list.length === 0 ? (
                  <div className="dash-empty">还没有考试记录</div>
                ) : (
                  <div className="dash-list">
                    {state.grades.list.map((g) => (
                      <div className="dash-list-item" key={g.attemptId}>
                        <div className="li-main">
                          <div className="li-title">{g.examName}</div>
                          <div className="li-meta">{formatDateTime(g.submittedAt)}</div>
                        </div>
                        <div className="text-right" style={{ flex: 'none' }}>
                          <div className="mono" style={{ color: g.scoreStatus === 'published' ? 'var(--oe-neon-cyan)' : 'var(--oe-text-dim)' }}>
                            {g.scoreStatus === 'published' ? formatScore(g.totalScore) : '评阅中'}
                          </div>
                          <div className="xs" style={{ color: 'var(--oe-text-dim)' }}>
                            {SCORE_STATUS_LABEL[g.scoreStatus]}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {state.failed.length ? (
                  <div className="alert-bar danger" style={{ marginTop: 12 }}>
                    以下数据不可用：<b>{state.failed.join('、')}</b>，请确认后端服务已启动。
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}