'use strict';

/**
 * 枚举、错误码、权限点映射（唯一事实来源：docs/design/系统设计文档.md §5.4）
 */

const ROLES = Object.freeze(['admin', 'teacher', 'student']);
const USER_STATUS = Object.freeze(['pending', 'active', 'disabled', 'locked']);
const QUESTION_TYPES = Object.freeze(['single', 'multiple', 'judge', 'fill', 'short']);
const OBJECTIVE_TYPES = Object.freeze(['single', 'multiple', 'judge', 'fill']);
const DIFFICULTY = Object.freeze([1, 2, 3, 4, 5]);
const PAPER_STATUS = Object.freeze(['draft', 'published', 'locked', 'archived']);
const EXAM_STATUS = Object.freeze(['draft', 'published', 'ongoing', 'finished', 'cancelled', 'archived']);
const ATTEMPT_STATUS = Object.freeze(['ongoing', 'submitted', 'grading', 'graded', 'reviewed', 'expired']);
const GRADING_STATUS = Object.freeze(['pending', 'auto_done', 'manual_pending', 'done']);
const GRADING_TASK_STATUS = Object.freeze(['pending', 'first_done', 'second_pending', 'arbitration', 'done']);
const APPEAL_STATUS = Object.freeze(['pending', 'accepted', 'rejected', 'closed']);
const NOTICE_TYPE = Object.freeze(['exam_publish', 'exam_change', 'score_publish', 'appeal', 'notice', 'system']);
const ANTI_CHEAT_EVENTS = Object.freeze(['switch_screen', 'exit_fullscreen', 'copy_paste', 'multi_device', 'blur']);

const HOME_ROUTES = Object.freeze({
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
});

/**
 * 错误码表：code -> { http, message }
 * 编码规则：首位模块（1=UAM 2=QBM 3=PPM 4=EXM 5=MRK 6=STA 7=SYS 9=通用），后 4 位模块内序号
 */
const ERROR_CODES = Object.freeze({
  // 通用
  90101: { http: 422, message: '参数校验失败' },
  90201: { http: 401, message: '请先登录' },
  90202: { http: 401, message: '登录状态失效，请重新登录' },
  90203: { http: 401, message: '登录已过期，请重新登录' },
  90204: { http: 401, message: '登录状态已失效，请重新登录' },
  90301: { http: 403, message: '无权访问该资源' },
  90302: { http: 403, message: '无权访问该数据' },
  90401: { http: 404, message: '资源不存在或已删除' },
  90409: { http: 409, message: '业务状态冲突' },
  90429: { http: 429, message: '请求过于频繁，请稍后再试' },
  90500: { http: 500, message: '服务器内部错误' },
  90503: { http: 503, message: '服务暂不可用' },
  // UAM
  10101: { http: 401, message: '用户名或密码错误' },
  10102: { http: 403, message: '账号待审核，请等待管理员审批' },
  10103: { http: 403, message: '账号已被禁用' },
  10104: { http: 423, message: '账号已被锁定，请稍后再试' },
  10105: { http: 409, message: '该学号已被注册或正在审核' },
  10106: { http: 409, message: '该邮箱已被使用' },
  10107: { http: 400, message: '密码强度不足：至少 8 位且包含大小写字母与数字' },
  10108: { http: 400, message: '原密码不正确' },
  10109: { http: 401, message: '刷新令牌已失效，请重新登录' },
  10110: { http: 409, message: '当前注册申请状态不允许该操作' },
  // QBM
  20101: { http: 400, message: '题型不合法' },
  20102: { http: 422, message: '答案与题型不匹配或为空' },
  20103: { http: 422, message: '选项缺失、重复或少于 2 项' },
  20104: { http: 400, message: '导入文件类型或大小不合法' },
  20105: { http: 400, message: '导入行数超过 5000 行上限' },
  20106: { http: 409, message: '题目已被引用，无法删除' },
  20107: { http: 409, message: '知识点已被题目引用，仅可归档' },
  20108: { http: 409, message: '同一所有者下题库名称重复' },
  20109: { http: 422, message: '采分点分值之和超过题目满分' },
  // PPM
  30101: { http: 422, message: '各题分值之和不等于设定总分' },
  30102: { http: 422, message: '试卷至少需要 1 道题' },
  30103: { http: 409, message: '试卷已锁定，禁止修改题目与分值' },
  30104: { http: 409, message: '试卷已归档，不可用于新建考试' },
  30105: { http: 409, message: '同一试卷不允许重复引用题目' },
  30106: { http: 409, message: '试卷已被考试引用，无法删除' },
  30107: { http: 409, message: '随机组卷可用题目不足' },
  30108: { http: 403, message: '题目不属于可用题库' },
  // EXM
  40101: { http: 400, message: '结束时间必须晚于开始时间' },
  40102: { http: 400, message: '答题时长不得超过考试窗口' },
  40103: { http: 422, message: '参考范围不能为空' },
  40104: { http: 409, message: '当前不在考试窗口内' },
  40105: { http: 409, message: '考试尚未开始' },
  40106: { http: 409, message: '考试已结束' },
  40107: { http: 403, message: '您不在本次考试的参考名单中' },
  40108: { http: 409, message: '作答次数已用尽，请联系教师申请补考' },
  40109: { http: 409, message: '答卷已交卷，禁止继续操作' },
  40110: { http: 409, message: '已存在进行中的答卷' },
  40111: { http: 409, message: '当前考试状态不允许该操作' },
  40112: { http: 409, message: '发布前试卷必须处于锁定状态' },
  40113: { http: 403, message: '答卷不属于当前用户' },
  40114: { http: 404, message: '答卷不存在' },
  // MRK
  50101: { http: 422, message: '得分必须在 0 到该题满分之间' },
  50102: { http: 422, message: '采分点得分合计与总分不一致' },
  50103: { http: 409, message: '阅卷任务已完成' },
  50104: { http: 409, message: '第二评阅卷人不能与第一评相同' },
  50105: { http: 409, message: '当前任务无需仲裁' },
  50106: { http: 409, message: '重判与答卷快照冲突或题目已归档' },
  50107: { http: 409, message: '已超过成绩复核申诉期限' },
  50108: { http: 409, message: '该题目已存在待处理申诉' },
  50109: { http: 409, message: '仍有主观题未阅完，不可发布成绩' },
  // STA
  60101: { http: 409, message: '成绩尚未发布，暂不可查看具体分数' },
  60102: { http: 409, message: '成绩已发布，不可重复发布' },
  60103: { http: 409, message: '导出数据量超出上限，请按班级拆分' },
  // SYS
  70101: { http: 403, message: '该参数不允许在线修改' },
  70102: { http: 400, message: '参数取值超出允许范围' },
  70103: { http: 409, message: '已有备份任务在执行' },
  70104: { http: 409, message: '公告状态不允许该操作' },
});

/** 默认系统参数（数据库不可用时兜底，正式值以 sys_config 为准） */
const DEFAULT_CONFIGS = Object.freeze({
  'exam.defaultDuration': '90',
  'exam.passScore': '60',
  'exam.autosaveIntervalSeconds': '30',
  'exam.antiCheatThreshold': '3',
  'security.accessTokenTtlSeconds': '7200',
  'security.refreshTokenTtlSeconds': '604800',
  'security.maxLoginFail': '5',
  'security.lockMinutes': '15',
  'security.bcryptCost': '10',
  'grading.multiChoiceStrategy': 'all_or_nothing',
  'grading.arbitrationThresholdRatio': '0.2',
  'system.appealWindowDays': '7',
  'system.auditRetentionDays': '180',
});

const SUBMIT_GRACE_SECONDS = 5;

module.exports = {
  ROLES,
  USER_STATUS,
  QUESTION_TYPES,
  OBJECTIVE_TYPES,
  DIFFICULTY,
  PAPER_STATUS,
  EXAM_STATUS,
  ATTEMPT_STATUS,
  GRADING_STATUS,
  GRADING_TASK_STATUS,
  APPEAL_STATUS,
  NOTICE_TYPE,
  ANTI_CHEAT_EVENTS,
  HOME_ROUTES,
  ERROR_CODES,
  DEFAULT_CONFIGS,
  SUBMIT_GRACE_SECONDS,
};