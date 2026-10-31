/**
 * 枚举字典与展示映射
 * 取值严格对齐 docs/design/api-contract.yaml 附录 A 枚举字典
 */

export const ROLE_LABEL = {
  admin: '管理员',
  teacher: '教师',
  student: '学生',
};

export const ROLE_HOME = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
};

export const QUESTION_TYPE_LABEL = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

export const QUESTION_TYPE_TAG = {
  single: 'tag-cyan',
  multiple: 'tag-violet',
  judge: 'tag-green',
  fill: 'tag-amber',
  short: 'tag-red',
};

export const DIFFICULTY_LABEL = {
  1: '极易',
  2: '较易',
  3: '中等',
  4: '较难',
  5: '困难',
};

export const USER_STATUS_LABEL = {
  pending: '待审核',
  active: '正常',
  disabled: '已禁用',
  locked: '已锁定',
};

export const USER_STATUS_TAG = {
  pending: 'tag-amber',
  active: 'tag-green',
  disabled: 'tag-red',
  locked: 'tag-red',
};

export const QUESTION_STATUS_LABEL = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
  active: '启用',
  deleted: '已删除',
};

export const QUESTION_STATUS_TAG = {
  draft: 'tag-neutral',
  published: 'tag-green',
  archived: 'tag-amber',
  active: 'tag-green',
  deleted: 'tag-red',
};

export const PAPER_STATUS_LABEL = {
  draft: '草稿',
  published: '已发布',
  locked: '已锁定',
  archived: '已归档',
  deleted: '已删除',
};

export const PAPER_STATUS_TAG = {
  draft: 'tag-neutral',
  published: 'tag-green',
  locked: 'tag-violet',
  archived: 'tag-amber',
  deleted: 'tag-red',
};

export const EXAM_STATUS_LABEL = {
  draft: '草稿',
  published: '已发布',
  ongoing: '进行中',
  finished: '已结束',
  cancelled: '已取消',
  archived: '已归档',
};

export const EXAM_STATUS_TAG = {
  draft: 'tag-neutral',
  published: 'tag-cyan',
  ongoing: 'tag-green',
  finished: 'tag-violet',
  cancelled: 'tag-red',
  archived: 'tag-amber',
};

export const SCORE_STATUS_LABEL = {
  unpublished: '评阅中',
  published: '已发布',
};

export const ATTEMPT_STATUS_LABEL = {
  ongoing: '作答中',
  submitted: '已交卷',
  grading: '阅卷中',
  graded: '已判分',
  reviewed: '已复核',
  expired: '已超时',
};

export const TASK_STATUS_LABEL = {
  pending: '待阅卷',
  first_done: '一评完成',
  second_pending: '待二评',
  arbitration: '待仲裁',
  done: '已完成',
};

export const TASK_STATUS_TAG = {
  pending: 'tag-amber',
  first_done: 'tag-cyan',
  second_pending: 'tag-violet',
  arbitration: 'tag-red',
  done: 'tag-green',
};

export const EXAM_TASK_STATUS_LABEL = {
  pending: '待作答',
  doing: '作答中',
  submitted: '已交卷',
  missed: '缺考',
};

export const EXAM_TASK_STATUS_TAG = {
  pending: 'tag-neutral',
  doing: 'tag-cyan',
  submitted: 'tag-green',
  missed: 'tag-red',
};

export const GRADING_STATUS_LABEL = {
  pending: '待判分',
  auto_done: '自动判分完成',
  manual_pending: '待人工阅卷',
  done: '判分完成',
};

export const APPEAL_STATUS_LABEL = {
  pending: '待处理',
  accepted: '已采纳',
  rejected: '已驳回',
  closed: '已关闭',
};

export const APPEAL_STATUS_TAG = {
  pending: 'tag-amber',
  accepted: 'tag-green',
  rejected: 'tag-red',
  closed: 'tag-neutral',
};

export const ANTI_CHEAT_TYPE_LABEL = {
  switch_screen: '切换屏幕',
  exit_fullscreen: '退出全屏',
  copy_paste: '复制粘贴',
  multi_device: '多端登录',
  blur: '窗口失焦',
};

export const NOTICE_TARGET_LABEL = {
  all: '全部角色',
  admin: '管理员',
  teacher: '教师',
  student: '学生',
};

export const NOTICE_STATUS_LABEL = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
};

export const CONFIG_GROUP_LABEL = {
  exam: '考试参数',
  security: '安全参数',
  grading: '阅卷参数',
  system: '系统参数',
};

export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABEL);
export const TASK_TYPES = Object.keys(TASK_STATUS_LABEL);

/** 状态 → 标签组件 class */
export function tagClass(map, value) {
  return map[value] || 'tag-neutral';
}

/** 安全取标签文案 */
export function labelOf(map, value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return map[value] ?? String(value);
}