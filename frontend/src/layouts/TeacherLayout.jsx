import ShellLayout from './ShellLayout.jsx';

/**
 * 教师布局
 * 菜单对应 REQ-QBM/PPM/EXM/MRK/STA：题库、组卷、考试、阅卷、统计
 */
const NAV_GROUPS = [
  {
    label: '总览',
    items: [{ to: '/teacher/dashboard', label: '教学工作台', icon: 'DB', end: true }],
  },
  {
    label: '教学准备',
    items: [
      { to: '/teacher/questions', label: '题库与题目', icon: 'QB' },
      { to: '/teacher/papers', label: '试卷管理', icon: 'PP' },
      { to: '/teacher/exams', label: '考试管理', icon: 'EX' },
    ],
  },
  {
    label: '阅卷与成绩',
    items: [
      { to: '/teacher/reviews', label: '阅卷与复核', icon: 'MK' },
      { to: '/teacher/stats', label: '成绩统计', icon: 'ST' },
    ],
  },
];

export default function TeacherLayout() {
  return <ShellLayout navGroups={NAV_GROUPS} roleCode="teacher" />;
}