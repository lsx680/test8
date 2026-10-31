import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listUsers, listPendingRegistrations } from '../../api/users.js';
import { listExams } from '../../api/exams.js';
import { listAuditLogs, getHealth } from '../../api/audit.js';
import { useAuthStore } from '../../store/authStore.js';
import StatCard from '../../components/StatCard.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Loading from '../../components/Loading.jsx';
import { formatDateTime, formatPercent } from '../../utils/format.js';

/**
 * 管理员工作台
 * 契约未提供 dashboard 聚合端点，此处按需并行调用已有列表接口（各取 1 条以获得 total）。
 * 任一接口失败显示"不可用"，不使用假数据。
 */
export default function AdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState({
    users: null,
    pending: null,
    exams: null,
    logs: null,
    health: null,
  });
  const [recentLogs, setRecentLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState([]);

  useEffect(() => {
    let alive = true;
    const settle = (promise) =>
      promise
        .then((data) => (data === null || data === undefined ? { ok: false } : { ok: true, data }))
        .catch((err) => ({ ok: false, err }));

    Promise.all([
      settle(listUsers({ page: 1, pageSize: 1 })),
      settle(listPendingRegistrations({ page: 1, pageSize: 1 })),
      settle(listExams({ page: 1, pageSize: 1 })),
      settle(listAuditLogs({ page: 1, pageSize: 6 })),
      settle(getHealth()),
    ]).then(([users, pending, exams, logs, health]) => {
      if (!alive) return;
      const fails = [];
      if (!users.ok) fails.push('用户统计');
      if (!pending.ok) fails.push('待审核统计');
      if (!exams.ok) fails.push('考试统计');
      if (!logs.ok) fails.push('审计日志');
      if (!health.ok) fails.push('健康检查');
      setFailed(fails);
      setStats({
        users: users.ok ? users.data?.total ?? 0 : null,
        pending: pending.ok ? pending.data?.total ?? 0 : null,
        exams: exams.ok ? exams.data?.total ?? 0 : null,
        logs: logs.ok ? logs.data?.total ?? 0 : null,
        health: health.ok ? health.data : null,
      });
      setRecentLogs(logs.ok ? logs.data?.list || [] : []);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page-cyber">
      <PageHeader
        className="on-dark"
        title={`你好，${user?.realName || '管理员'}`}
        desc="从账号治理、考试监管到参数与审计，统一维护考试系统的运行秩序。"
        actions={
          <Link to="/admin/users" className="btn btn-primary">
            审核注册申请
          </Link>
        }
      />

      <div className="hero">
        <div className="hero-eyebrow">
          <span className="pulse" aria-hidden="true" />
          ADMIN CONTROL CENTER
        </div>
        <h2 className="hero-title">
          考试治理看板 <span className="neon-text">/ 全量数据</span>
        </h2>
        <p className="hero-desc">
          管理员拥有全量数据与配置权限：账号与角色、知识点字典、考试监管、争议仲裁、系统参数与审计日志。
          组卷与发考动作由教师执行（权限矩阵第 10、14 项），管理员只做监管与纠偏。
        </p>
        <div className="hero-meta">
          <div>
            <span>服务状态</span>
            <b>{stats.health?.status === 'up' ? 'UP' : stats.health ? 'DEGRADED' : '—'}</b>
          </div>
          <div>
            <span>数据库</span>
            <b>{stats.health?.database === 'connected' ? 'CONNECTED' : stats.health ? 'DISCONNECTED' : '—'}</b>
          </div>
          <div>
            <span>版本</span>
            <b>{stats.health?.version || '—'}</b>
          </div>
          <div>
            <span>服务端时间</span>
            <b>{stats.health?.serverTime ? formatDateTime(stats.health.serverTime) : '—'}</b>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="panel-dark">
          <Loading text="正在汇总系统数据…" />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="系统账号总数" value={stats.users ?? '—'} unit="人" tone="cyan" hint="含待审核与已禁用账号" />
            <StatCard label="待审核注册申请" value={stats.pending ?? '—'} unit="条" tone="magenta" hint="审核通过后方可登录" />
            <StatCard label="考试总数" value={stats.exams ?? '—'} unit="场" tone="violet" hint="含草稿与已归档考试" />
            <StatCard label="审计日志总量" value={stats.logs ?? '—'} unit="条" tone="green" hint="敏感操作全量留痕" />
          </div>

          <div className="dash-grid">
            <section className="panel-dark">
              <div className="panel-dark-head">
                <h3>最近审计事件</h3>
                <Link to="/admin/audit-logs" className="dash-link">
                  查看全部 →
                </Link>
              </div>
              <div className="panel-dark-body">
                {recentLogs.length === 0 ? (
                  <div className="dash-empty">暂无可展示的审计记录</div>
                ) : (
                  <div className="dash-list">
                    {recentLogs.map((log) => (
                      <div className="dash-list-item" key={log.id}>
                        <div className="li-main">
                          <div className="li-title">
                            {log.username || '系统'} · {log.action}
                          </div>
                          <div className="li-meta">
                            {log.module?.toUpperCase()} · {log.httpMethod || '—'} {log.path || ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flex: 'none' }}>
                          <span className={`tag tag-dark ${log.result === 'success' ? 'cyan' : 'magenta'}`}>
                            {log.result === 'success' ? '成功' : '失败'}
                          </span>
                          <div className="li-meta">{formatDateTime(log.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel-dark">
              <div className="panel-dark-head">
                <h3>运行提示</h3>
                <span className="tag tag-dark violet">OPS</span>
              </div>
              <div className="panel-dark-body">
                <div className="notice-dark" style={{ marginBottom: 12 }}>
                  <span className="ico" aria-hidden="true">◆</span>
                  <div>
                    <b>健康检查</b>
                    <br />
                    接口 GET /health，响应时间应 ≤200ms（REQ-SYS-06）。
                    当前 {stats.health?.uptimeSeconds ? `已运行 ${Math.round(stats.health.uptimeSeconds / 60)} 分钟` : '状态未知'}。
                  </div>
                </div>

                <div className="dash-list">
                  <div className="dash-list-item">
                    <span className="li-title">系统参数配置</span>
                    <Link to="/admin/configs" className="dash-link">进入</Link>
                  </div>
                  <div className="dash-list-item">
                    <span className="li-title">知识点字典维护</span>
                    <Link to="/admin/knowledge-points" className="dash-link">进入</Link>
                  </div>
                  <div className="dash-list-item">
                    <span className="li-title">标准答案修正与重判</span>
                    <Link to="/teacher/questions" className="dash-link">说明</Link>
                  </div>
                  <div className="dash-list-item">
                    <span className="li-title">争议仲裁队列</span>
                    <Link to="/admin/arbitration" className="dash-link">进入</Link>
                  </div>
                </div>

                {failed.length ? (
                  <div className="alert-bar danger" style={{ marginTop: 14 }}>
                    以下数据暂不可用：<b>{failed.join('、')}</b>。请确认后端服务已启动后刷新页面。
                  </div>
                ) : null}

                <div className="xs" style={{ color: 'var(--oe-text-dim)', marginTop: 14, lineHeight: 1.8 }}>
                  近期审计成功率：
                  <b style={{ color: 'var(--oe-text)' }}>
                    {' '}
                    {recentLogs.length
                      ? formatPercent(
                          (recentLogs.filter((l) => l.result === 'success').length / recentLogs.length) * 100,
                        )
                      : '—'}
                  </b>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}