import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';
import { ROLE_HOME, ROLE_LABEL } from '../../utils/enums.js';

/**
 * 403 权限不足页（守卫与接口 403 共用）
 * 500 场景通过 code 参数复用同一视觉
 */
export default function Forbidden({ code = 403 }) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const home = user ? ROLE_HOME[user.roleCode] : '/login';

  const is500 = code === 500;
  const title = is500 ? '服务暂时不可用' : '无权访问该页面';
  const desc = is500
    ? '服务端发生异常或正在降级，请稍后重试；若持续出现请联系系统管理员。'
    : user
      ? `当前身份「${ROLE_LABEL[user.roleCode] || user.roleCode}」没有访问 ${location.pathname} 的权限。前端的菜单隐藏不构成安全边界，服务端会再次校验。`
      : '请先登录后再访问该页面。';

  return (
    <div className="cyber-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="auth-card" style={{ width: 'min(560px, 100%)', textAlign: 'center', padding: '44px 36px' }}>
        <div
          className="neon-text"
          style={{ fontFamily: 'var(--oe-font-mono)', fontSize: 72, fontWeight: 800, lineHeight: 1 }}
        >
          {code}
        </div>
        <h1 style={{ marginTop: 18, fontSize: 24, fontWeight: 700 }}>{title}</h1>
        <p style={{ marginTop: 10, color: 'var(--oe-text-muted)', lineHeight: 1.8, fontSize: 14 }}>{desc}</p>

        <div className="neon-rule" style={{ margin: '26px 0 22px' }} />

        <div className="row gap-3" style={{ justifyContent: 'center' }}>
          <Link to={home}>
            <button type="button" className="btn btn-primary">
              {status === 'authed' ? '返回工作台' : '前往登录'}
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