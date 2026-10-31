'use strict';

/** JSON 列在 mysql2 中可能以字符串或对象返回，统一解析 */
function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

/** tinyint(1) → boolean，null 保持 null */
function toBool(value) {
  if (value === null || value === undefined) return null;
  return Boolean(Number(value));
}

/** Date → ISO-8601；字符串原样返回 */
function toIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** 数值规范化（DECIMAL 已在连接池转为 Number，这里兜底字符串场景） */
function toNum(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 考生视角题目白名单投影：绝不输出 correctAnswer / analysis / scoringPoints
 * 入参为 attemptModel.listAttemptQuestions 映射后的 lowerCamelCase 对象
 */
function projectAttemptQuestion(row) {
  const snapshot = row.snapshot || {};
  return {
    attemptQuestionId: row.id,
    questionId: row.questionId,
    orderNo: row.orderNo,
    questionType: row.questionType,
    stem: snapshot.stem || '',
    options: snapshot.options || null,
    fullScore: row.fullScore,
    studentAnswer: row.studentAnswer === undefined ? null : row.studentAnswer,
    answerSavedAt: row.answerSavedAt || null,
  };
}

/** 试卷预览投影：同样剥离答案与解析 */
function projectPaperQuestion(question) {
  return {
    paperQuestionId: question.paperQuestionId,
    questionId: question.questionId,
    questionNo: question.questionNo || null,
    questionType: question.questionType,
    difficulty: question.difficulty === undefined ? null : question.difficulty,
    stem: question.stem || '',
    options: question.options || null,
    knowledgePointId: question.knowledgePointId === undefined ? null : question.knowledgePointId,
    sectionNo: question.sectionNo,
    orderNo: question.orderNo,
    score: question.score,
  };
}

/** 审计请求摘要脱敏：密码/令牌/答案统一替换 */
const SENSITIVE_KEYS = new Set([
  'password',
  'oldPassword',
  'newPassword',
  'confirmPassword',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'correctAnswer',
  'studentAnswer',
  'temporaryPassword',
  'initialPassword',
  'authorization',
]);

function sanitizeForAudit(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.map((item) => sanitizeForAudit(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key) ? '***' : sanitizeForAudit(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}...[truncated]`;
  return value;
}

module.exports = {
  parseJson,
  toBool,
  toIso,
  toNum,
  projectAttemptQuestion,
  projectPaperQuestion,
  sanitizeForAudit,
};