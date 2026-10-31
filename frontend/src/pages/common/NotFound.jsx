import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';
import { ROLE_HOME } from '../../utils/enums.js';

/** 404 页面（路由未匹配） */
export default function NotFound() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const home = user ? ROLE_HOME[user.roleCode] : '/login';

  return (
    <div className="cyber-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="auth-card" style={{ width: 'min(560px, 100%)', textAlign: 'center', padding: '44px 36px' }}>
        <div
          className="neon-text"
          style={{ fontFamily: 'var(--oe-font-mono)', fontSize: 72, fontWeight: 800, lineHeight: 1 }}
        >
          404
        </div>
        <h1 style={{ marginTop: 18, fontSize: 24, fontWeight: 700 }}>页面不存在</h1>
        <p style={{ marginTop: 10, color: 'var(--oe-text-muted)', lineHeight: 1.8, fontSize: 14 }}>
          未找到路径 <code style={{ color: 'var(--oe-neon-cyan)' }}>{location.pathname}</code>。
          该页面可能已下线或链接输入有误。
        </p>

        <div className="neon-rule" style={{ margin: '26px 0 22px' }} />

        <div className="row gap-3" style={{ justifyContent: 'center' }}>
          <Link to={home}>
            <button type="button" className="btn btn-primary">
              返回工作台
            </button>
          </Link>
          <button type="button" className="btn btn-secondary on-dark" onClick={() => window.history.back()}>
            返回上一页
          </button>
        </div>
      </div>
    </div>
  );
}