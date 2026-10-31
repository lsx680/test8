import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';
import { listExams } from '../../api/exams.js';
import { listPapers } from '../../api/papers.js';
import { listQuestions } from '../../api/questions.js';
import { listGradingTasks } from '../../api/reviews.js';
import { listAppeals } from '../../api/stats.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatCard from '../../components/StatCard.jsx';
import Loading from '../../components/Loading.jsx';
import Tag from '../../components/Tag.jsx';
import { formatDateTime, formatPercent, formatScore } from '../../utils/format.js';
import { EXAM_STATUS_LABEL, EXAM_STATUS_TAG, tagClass } from '../../utils/enums.js';

/**
 * 教师工作台
 * 数据来源均为契约已有列表接口（各取 1 条读取 total），不提供 dashboard 聚合端点。
 */
export default function TeacherDashboard() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState({
    loading: true,
    failed: [],
    exams: { total: 0, list: [] },
    papers: 0,
    questions: 0,
    pendingGrading: 0,
    pendingAppeals: 0,
  });

  useEffect(() => {
    let alive = true;
    const settle = (p) =>
      p
        .then((d) => (d === null || d === undefined ? { ok: false } : { ok: true, d }))
        .catch(() => ({ ok: false }));
    const now = new Date();
    Promise.all([
      settle(listExams({ page: 1, pageSize: 5 })),
      settle(listPapers({ page: 1, pageSize: 1 })),
      settle(listQuestions({ page: 1, pageSize: 1 })),
      settle(listGradingTasks({ page: 1, pageSize: 1, status: 'pending' })),
      settle(listAppeals({ page: 1, pageSize: 1, status: 'pending' })),
    ]).then(([exams, papers, questions, grading, appeals]) => {
      if (!alive) return;
      const failed = [];
      if (!exams.ok) failed.push('考试');
      if (!papers.ok) failed.push('试卷');
      if (!questions.ok) failed.push('题库');
      if (!grading.ok) failed.push('阅卷任务');
      if (!appeals.ok) failed.push('申诉');
      setState({
        loading: false,
        failed,
        exams: exams.ok ? { total: exams.d?.total || 0, list: exams.d?.list || [] } : { total: 0, list: [] },
        papers: papers.ok ? papers.d?.total || 0 : 0,
        questions: questions.ok ? questions.d?.total || 0 : 0,
        pendingGrading: grading.ok ? grading.d?.pendingCount ?? grading.d?.total ?? 0 : 0,
        pendingAppeals: appeals.ok ? appeals.d?.total || 0 : 0,
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const now = new Date();
  const upcoming = state.exams.list.filter((e) => new Date(e.endTime) >= now).length;

  return (
    <div className="page-cyber">
      <PageHeader
        className="on-dark"
        title={`你好，${user?.realName || '老师'}`}
        desc="维护题库、规则化组卷、发布考试、批阅主观题并发布成绩 —— 教学工作在同一处闭环完成。"
        actions={
          <Link to="/teacher/exams/new" className="btn btn-primary">
            + 创建考试
          </Link>
        }
      />

      <div className="hero">
        <div className="hero-eyebrow">
          <span className="pulse" aria-hidden="true" />
          TEACHING CONSOLE · 教学执行终端
        </div>
        <h2 className="hero-title">
          教学数据概览 <span className="neon-text">/ 我的课程</span>
        </h2>
        <p className="hero-desc">
          数据范围严格限制在本人创建或被授权的题库、试卷与考试内（需求 §3.3 数据范围控制）。
          交卷后客观题自动判分，简答题进入人工阅卷队列；阅卷完成后即可发布成绩。
        </p>
        <div className="hero-meta">
          <div>
            <span>进行/待考考试</span>
            <b>{upcoming}</b>
          </div>
          <div>
            <span>待阅课任务</span>
            <b>{state.pendingGrading}</b>
          </div>
          <div>
            <span>待处理申诉</span>
            <b>{state.pendingAppeals}</b>
          </div>
          <div>
            <span>当前时间</span>
            <b>{formatDateTime(new Date())}</b>
          </div>
        </div>
      </div>

      {state.loading ? (
        <div className="panel-dark">
          <Loading text="正在加载教学数据…" />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="题库题目" value={state.questions} unit="题" tone="cyan" hint="本人及被授权题库" />
            <StatCard label="试卷" value={state.papers} unit="份" tone="violet" hint="含草稿与已发布" />
            <StatCard label="考试" value={state.exams.total} unit="场" tone="magenta" hint="本人创建的考试" />
            <StatCard label="待阅卷" value={state.pendingGrading} unit="份" tone="green" hint="主观题人工阅卷队列" />
          </div>

          <div className="dash-grid">
            <section className="panel-dark">
              <div className="panel-dark-head">
                <h3>最近考试</h3>
                <Link to="/teacher/exams" className="dash-link">全部考试 →</Link>
              </div>
              <div className="panel-dark-body">
                {state.exams.list.length === 0 ? (
                  <div className="dash-empty">还没有创建考试，先准备一份试卷吧</div>
                ) : (
                  <div className="dash-list">
                    {state.exams.list.map((exam) => (
                      <div className="dash-list-item" key={exam.id}>
                        <div className="li-main">
                          <div className="li-title">{exam.examName}</div>
                          <div className="li-meta">
                            {formatDateTime(exam.startTime)} → {formatDateTime(exam.endTime)}
                          </div>
                        </div>
                        <div className="row gap-2" style={{ flex: 'none' }}>
                          <span className={`tag tag-dark ${exam.status === 'ongoing' ? 'cyan' : exam.status === 'finished' ? 'violet' : ''}`}>
                            {EXAM_STATUS_LABEL[exam.status] || exam.status}
                          </span>
                          <Link to={`/teacher/exams/${exam.id}/edit`} className="dash-link">管理</Link>
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

            <section className="panel-dark">
              <div className="panel-dark-head">
                <h3>快捷操作</h3>
                <span className="tag tag-dark cyan">QUICK</span>
              </div>
              <div className="panel-dark-body">
                <div className="dash-list">
                  <div className="dash-list-item">
                    <div className="li-main">
                      <div className="li-title">新建题目</div>
                      <div className="li-meta">五种题型 · 支持批量导入</div>
                    </div>
                    <Link to="/teacher/questions/new" className="dash-link">进入</Link>
                  </div>
                  <div className="dash-list-item">
                    <div className="li-main">
                      <div className="li-title">组卷（手动 / 随机）</div>
                      <div className="li-meta">总分校验 · 难度分布 · 缺口提示</div>
                    </div>
                    <Link to="/teacher/papers/new" className="dash-link">进入</Link>
                  </div>
                  <div className="dash-list-item">
                    <div className="li-main">
                      <div className="li-title">主观题阅卷</div>
                      <div className="li-meta">逐题打分 · 采分点 · 评语</div>
                    </div>
                    <Link to="/teacher/reviews" className="dash-link">进入</Link>
                  </div>
                  <div className="dash-list-item">
                    <div className="li-main">
                      <div className="li-title">成绩统计与发布</div>
                      <div className="li-meta">分数段 · 正确率 · 区分度</div>
                    </div>
                    <Link to="/teacher/stats" className="dash-link">进入</Link>
                  </div>
                </div>

                <div className="notice-dark" style={{ marginTop: 14 }}>
                  <span className="ico" aria-hidden="true">◆</span>
                  <div>
                    <b>阅卷提示</b>
                    <br />
                    成绩发布前学生仅可见「评阅中」。存在未阅完主观题时，发布成绩会被服务端拒绝（50109）。
                    当前待阅任务 <b>{state.pendingGrading}</b> 份，清零后方可发布。
                  </div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}