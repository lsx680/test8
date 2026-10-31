import { Outlet } from 'react-router-dom';
import { API_BASE_URL } from '../api/http.js';

/**
 * 登录/注册外壳：全屏深色霓虹，页面自身负责左右分栏布局
 */
export default function AuthLayout() {
  return (
    <div className="cyber-bg" style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
      <div className="cyber-scan" aria-hidden="true" />
      <Outlet />
      <footer
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 10,
          textAlign: 'center',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--oe-text-dim)',
          pointerEvents: 'none',
        }}
      >
        OES · 在线考试系统 v1.0.0 · API {API_BASE_URL}
      </footer>
    </div>
  );
}