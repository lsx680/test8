import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { ROLE_HOME, ROLE_LABEL } from '../utils/enums.js';

/**
 * 工作台外壳（深色霓虹侧边栏 + 顶栏 + 浅色内核内容区）
 * 三个角色布局通过 navGroups 注入各自菜单，菜单可见性依据需求文档权限矩阵。
 */
export default function ShellLayout({ navGroups = [], roleCode, children }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const flat = navGroups.flatMap((g) => g.items);
  const current =
    flat.find((item) => item.to === location.pathname) ||
    flat.find((item) => item.to !== '/' && location.pathname.startsWith(item.to)) ||
    { label: '工作台', to: '/' };

  const home = ROLE_HOME[roleCode] || '/';

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <aside className="shell-side">
        <NavLink to={home} className="side-brand">
          <span className="brand-mark">OES</span>
          <span className="brand-text">
            <span className="brand-name">OES 考试系统</span>
            <span className="brand-sub">ONLINE EXAM</span>
          </span>
        </NavLink>

        <nav className="side-nav" aria-label="主导航">
          {navGroups.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <span className="nav-ico" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <div>
            登录身份：<span className="ver">{ROLE_LABEL[roleCode] || roleCode}</span>
          </div>
          <div>
            接口契约：<span className="ver">OpenAPI 3.0 · 102 endpoints</span>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="shell-top">
          <div className="top-crumb">
            <span>OES</span>
            <span className="sep">/</span>
            <span>{ROLE_LABEL[roleCode] || roleCode}</span>
            <span className="sep">/</span>
            <b>{current.label}</b>
          </div>

          <div className="top-actions">
            <span className="role-chip">
              <span className="dot" aria-hidden="true" />
              {ROLE_LABEL[roleCode] || roleCode}工作台
            </span>
            <div className="top-user">
              <span className="avatar" aria-hidden="true">
                {(user?.realName || user?.username || 'U').slice(0, 1)}
              </span>
              <span className="top-user-meta">
                <b>{user?.realName || '未命名用户'}</b>
                <span>{user?.username}{user?.className ? ` · ${user.className}` : ''}</span>
              </span>
              <button type="button" className="top-exit" onClick={handleLogout}>
                退出
              </button>
            </div>
          </div>
        </header>

        <main className="shell-content">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}