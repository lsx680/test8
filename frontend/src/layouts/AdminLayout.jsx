import ShellLayout from './ShellLayout.jsx';

/**
 * 管理员布局
 * 菜单依据需求文档 §3.2 权限矩阵：账号管理、角色权限、知识点、
 * 考试监管（只读）、仲裁、参数、审计日志；不提供组卷入口（矩阵第 10 项）。
 */
const NAV_GROUPS = [
  {
    label: '总览',
    items: [{ to: '/admin/dashboard', label: '管理工作台', icon: 'DB', end: true }],
  },
  {
    label: '组织与权限',
    items: [
      { to: '/admin/users', label: '账号管理', icon: 'US' },
      { to: '/admin/roles', label: '角色与权限', icon: 'RB' },
      { to: '/admin/knowledge-points', label: '知识点维护', icon: 'KP' },
    ],
  },
  {
    label: '考试监管',
    items: [
      { to: '/admin/supervision', label: '考试与试卷监管', icon: 'SV' },
      { to: '/admin/arbitration', label: '争议仲裁', icon: 'AR' },
    ],
  },
  {
    label: '系统',
    items: [
      { to: '/admin/configs', label: '系统参数', icon: 'CF' },
      { to: '/admin/audit-logs', label: '审计日志', icon: 'AU' },
    ],
  },
];

export default function AdminLayout() {
  return <ShellLayout navGroups={NAV_GROUPS} roleCode="admin" />;
}