import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { ROLE_HOME } from '../utils/enums.js';

/**
 * 路由守卫（体验层）
 * ------------------------------------------------------------
 * 设计文档 §3.1.9：守卫只做体验层拦截，真正的权限校验在服务端。
 * - RequireAuth：未登录跳 /login 并携带 redirect
 * - RequireRole：角色不匹配跳 /403
 * - RedirectIfAuthed：已登录访问登录/注册页时回到对应工作台
 */

function BootLoading() {
  return (
    <div className="cyber-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="state-box" style={{ color: 'var(--oe-text-muted)' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--oe-neon-cyan)' }} />
        <span style={{ fontSize: 'var(--oe-text-sm)', letterSpacing: '0.08em' }}>
          正在校验登录状态…
        </span>
      </div>
    </div>
  );
}

/** 应用启动时恢复会话（仅执行一次） */
export function AuthBootstrap() {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    if (status === 'idle') bootstrap();
  }, [status, bootstrap]);

  return null;
}

export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'idle' || status === 'loading') return <BootLoading />;
  if (status !== 'authed') {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}

export function RequireRole({ roles = [] }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (roles.length && !roles.includes(user.roleCode)) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === 'idle' || status === 'loading') return <BootLoading />;
  if (status === 'authed' && user) {
    return <Navigate to={ROLE_HOME[user.roleCode] || '/'} replace />;
  }
  return <Outlet />;
}

/** 根路径分流：已登录进工作台，否则进登录页 */
export function HomeRedirect() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === 'idle' || status === 'loading') return <BootLoading />;
  if (status === 'authed' && user) return <Navigate to={ROLE_HOME[user.roleCode] || '/login'} replace />;
  return <Navigate to="/login" replace />;
}