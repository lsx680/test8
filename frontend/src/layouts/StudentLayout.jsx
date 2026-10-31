import ShellLayout from './ShellLayout.jsx';

/**
 * 学生布局
 * 学生仅可访问本人考试与成绩；在线答题页使用独立全屏布局（不带侧边栏）
 */
const NAV_GROUPS = [
  {
    label: '总览',
    items: [{ to: '/student/dashboard', label: '学习工作台', icon: 'DB', end: true }],
  },
  {
    label: '我的考试',
    items: [
      { to: '/student/exams', label: '考试列表', icon: 'EX' },
      { to: '/student/results', label: '我的成绩', icon: 'GR' },
    ],
  },
];

export default function StudentLayout() {
  return <ShellLayout navGroups={NAV_GROUPS} roleCode="student" />;
}