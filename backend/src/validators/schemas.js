'use strict';

/** zod 请求体/参数模式（与 api-contract.yaml 对齐） */
const { z } = require('zod');

const id = z.coerce.number().int().positive();
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}).passthrough();

const usernamePattern = /^[A-Za-z0-9_-]{4,32}$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;

const register = z.object({
  username: z.string().regex(usernamePattern, '学号格式为 4~32 位字母、数字、下划线或短横线'),
  realName: z.string().min(1).max(64),
  password: z.string().regex(passwordPattern, '密码至少 8 位且包含大小写字母与数字'),
  classId: id,
  email: z.string().email('邮箱格式不合法'),
  phone: z.string().max(32).optional(),
});

const login = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  captchaId: z.string().optional(),
  captchaCode: z.string().optional(),
});

const refresh = z.object({ refreshToken: z.string().min(1) });
const logout = z.object({ refreshToken: z.string().optional() });
const profile = z.object({
  realName: z.string().min(1).max(64).optional(),
  email: z.string().email('邮箱格式不合法').optional(),
  phone: z.string().max(32).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: '至少需要修改一个字段' });

const changePassword = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().regex(passwordPattern, '新密码至少 8 位且包含大小写字母与数字'),
  confirmPassword: z.string().min(1),
});

const userCreate = z.object({
  username: z.string().regex(usernamePattern, '用户名格式为 4~32 位字母、数字、下划线或短横线'),
  realName: z.string().min(1).max(64),
  roleCode: z.enum(['admin', 'teacher', 'student']),
  email: z.string().email('邮箱格式不合法').nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  classId: id.nullish(),
  department: z.string().max(64).nullable().optional(),
  remark: z.string().max(255).nullable().optional(),
});

const userUpdate = z.object({
  realName: z.string().min(1).max(64).optional(),
  email: z.string().email('邮箱格式不合法').nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  classId: id.nullish(),
  department: z.string().max(64).nullable().optional(),
  remark: z.string().max(255).nullable().optional(),
});

const userStatus = z.object({
  status: z.enum(['active', 'disabled']),
  reason: z.string().max(255).optional(),
});

const userRole = z.object({
  roleCode: z.enum(['admin', 'teacher', 'student']),
  permissionCodes: z.array(z.string()).optional(),
});

const rejectRegistration = z.object({ reason: z.string().min(1).max(255) });

const classCreate = z.object({
  classCode: z.string().min(1).max(32),
  className: z.string().min(1).max(64),
  gradeYear: z.coerce.number().int().min(1900).max(2200),
  department: z.string().max(64).optional(),
  headTeacherId: id.nullish(),
});

const knowledgePoint = z.object({
  kpCode: z.string().max(32).optional(),
  kpName: z.string().min(1).max(64),
  parentId: id.nullish(),
  level: z.union([z.literal(1), z.literal(2)]),
  sortOrder: z.coerce.number().int().optional(),
});

const knowledgePointStatus = z.object({ status: z.enum(['active', 'archived']) });

const questionBank = z.object({
  bankCode: z.string().max(32).optional(),
  bankName: z.string().min(1).max(128),
  description: z.string().max(500).nullable().optional(),
  visibility: z.enum(['private', 'shared']).optional(),
});

const bankAuthorization = z.object({
  granteeId: id,
  canWrite: z.boolean().optional(),
});

const questionOption = z.object({
  key: z.string().min(1),
  content: z.string().min(1),
});

const scoringPoint = z.object({
  point: z.string().min(1),
  score: z.coerce.number().nonnegative(),
});

const questionCreate = z.object({
  bankId: id,
  knowledgePointId: id.nullish(),
  questionType: z.enum(['single', 'multiple', 'judge', 'fill', 'short']),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  stem: z.string().min(1),
  options: z.array(questionOption).nullable().optional(),
  correctAnswer: z.array(z.string()),
  scoringPoints: z.array(scoringPoint).nullable().optional(),
  analysis: z.string().nullable().optional(),
  defaultScore: z.coerce.number().positive(),
  status: z.enum(['draft', 'published']).optional(),
});

const questionUpdate = z.object({
  bankId: id.optional(),
  knowledgePointId: id.nullish(),
  questionType: z.enum(['single', 'multiple', 'judge', 'fill', 'short']).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  stem: z.string().min(1).optional(),
  options: z.array(questionOption).nullable().optional(),
  correctAnswer: z.array(z.string()).optional(),
  scoringPoints: z.array(scoringPoint).nullable().optional(),
  analysis: z.string().nullable().optional(),
  defaultScore: z.coerce.number().positive().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  version: z.coerce.number().int().positive().optional(),
});

const rejudge = z.object({
  correctAnswer: z.array(z.string()).min(1, '标准答案不能为空'),
  reason: z.string().max(500).optional(),
  scope: z.enum(['all', 'exam']).optional(),
  examId: id.nullish(),
});

const paperQuestionItem = z.object({
  questionId: id,
  score: z.coerce.number().positive(),
  sectionNo: z.coerce.number().int().positive().optional(),
  orderNo: z.coerce.number().int().positive().optional(),
});

const paperCreate = z.object({
  paperName: z.string().min(1).max(128),
  description: z.string().max(500).nullable().optional(),
  totalScore: z.coerce.number().positive(),
  durationMinutes: z.coerce.number().int().min(1).max(180),
  questions: z.array(paperQuestionItem).min(1, '试卷至少需要 1 道题'),
});

const paperUpdate = z.object({
  paperName: z.string().min(1).max(128).optional(),
  description: z.string().max(500).nullable().optional(),
  totalScore: z.coerce.number().positive().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(180).optional(),
});

const randomRule = z.object({
  questionType: z.enum(['single', 'multiple', 'judge', 'fill', 'short']),
  count: z.coerce.number().int().positive(),
  scorePerQuestion: z.coerce.number().positive(),
  difficultyDistribution: z.record(z.coerce.number()).optional(),
});

const randomPaper = z.object({
  paperName: z.string().min(1).max(128),
  description: z.string().max(500).nullable().optional(),
  totalScore: z.coerce.number().positive(),
  durationMinutes: z.coerce.number().int().min(1).max(180),
  bankIds: z.array(id).optional(),
  knowledgePointIds: z.array(id).optional(),
  rules: z.array(randomRule).min(1, '至少需要一条抽题规则'),
  saveDraft: z.boolean().optional(),
});

const paperQuestionAdd = z.object({ questions: z.array(paperQuestionItem).min(1) });
const paperQuestionUpdate = z.object({
  questions: z.array(z.object({
    paperQuestionId: id,
    score: z.coerce.number().positive(),
    orderNo: z.coerce.number().int().positive(),
    sectionNo: z.coerce.number().int().positive(),
  })).min(1),
});
const paperStatus = z.object({
  status: z.enum(['published', 'locked', 'archived']),
  reason: z.string().max(255).optional(),
});
const paperCopy = z.object({ paperName: z.string().min(1).max(128) });

const scope = z.object({
  classIds: z.array(id).optional(),
  studentIds: z.array(id).optional(),
});

const examCreate = z.object({
  examName: z.string().min(1).max(128),
  paperId: id,
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  durationMinutes: z.coerce.number().int().min(1).max(180),
  passScore: z.coerce.number().nonnegative().optional(),
  maxAttempts: z.coerce.number().int().min(1).max(5).optional(),
  shuffleQuestions: z.boolean().optional(),
  antiCheatEnabled: z.boolean().optional(),
  antiCheatThreshold: z.coerce.number().int().positive().optional(),
  autoSubmitOnTimeout: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
  scope,
});

const examUpdate = z.object({
  examName: z.string().min(1).max(128).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(180).optional(),
  passScore: z.coerce.number().nonnegative().optional(),
  antiCheatEnabled: z.boolean().optional(),
  antiCheatThreshold: z.coerce.number().int().positive().optional(),
  description: z.string().max(500).nullable().optional(),
  scope: scope.optional(),
});

const examStatus = z.object({
  status: z.enum(['cancelled', 'archived', 'finished']),
  endTime: z.string().optional(),
  reason: z.string().max(255).optional(),
  notifyStudents: z.boolean().optional(),
});

const examGrant = z.object({
  studentIds: z.array(id).min(1),
  extraAttempts: z.coerce.number().int().min(1).max(3),
  reason: z.string().min(1).max(255),
});

const startAttempt = z.object({ deviceKey: z.string().max(64).optional() });

const answerItem = z.object({
  questionId: id,
  answer: z.array(z.string()).nullable().optional(),
  answerVersion: z.coerce.number().int().nonnegative().optional(),
});

const saveAnswers = z.object({ answers: z.array(answerItem).min(1) });

const antiCheatEvent = z.object({
  eventType: z.enum(['switch_screen', 'exit_fullscreen', 'copy_paste', 'multi_device', 'blur']),
  detail: z.record(z.any()).nullable().optional(),
  clientTime: z.string().optional(),
});

const submit = z.object({ submitType: z.enum(['manual', 'timeout']).optional() });

const scoreSubmit = z.object({
  score: z.coerce.number().nonnegative(),
  comment: z.string().max(500).optional(),
  scoringPointScores: z.array(z.object({ point: z.string(), score: z.coerce.number().nonnegative() })).optional(),
});

const arbitrate = z.object({ score: z.coerce.number().nonnegative(), reason: z.string().min(1).max(500) });

const appealCreate = z.object({
  examId: id,
  questionId: id.nullish(),
  reason: z.string().min(1).max(1000),
});

const appealHandle = z.object({
  status: z.enum(['accepted', 'rejected', 'closed']),
  comment: z.string().min(1).max(500),
  newScore: z.coerce.number().nonnegative().nullable().optional(),
});

const configUpdate = z.object({
  configValue: z.string(),
  reason: z.string().max(255).optional(),
});

const noticeCreate = z.object({
  title: z.string().min(1).max(128),
  content: z.string().min(1),
  targetRole: z.enum(['all', 'admin', 'teacher', 'student']),
  publishAt: z.string().nullable().optional(),
  expireAt: z.string().nullable().optional(),
  status: z.enum(['draft', 'published', 'offline']).optional(),
});

const paramsId = z.object({ id });

module.exports = {
  id,
  pageQuery,
  paramsId,
  register,
  login,
  refresh,
  logout,
  profile,
  changePassword,
  userCreate,
  userUpdate,
  userStatus,
  userRole,
  rejectRegistration,
  classCreate,
  knowledgePoint,
  knowledgePointStatus,
  questionBank,
  bankAuthorization,
  questionCreate,
  questionUpdate,
  rejudge,
  paperCreate,
  paperUpdate,
  randomPaper,
  paperQuestionAdd,
  paperQuestionUpdate,
  paperStatus,
  paperCopy,
  examCreate,
  examUpdate,
  examStatus,
  examGrant,
  startAttempt,
  saveAnswers,
  antiCheatEvent,
  submit,
  scoreSubmit,
  arbitrate,
  appealCreate,
  appealHandle,
  configUpdate,
  noticeCreate,
};