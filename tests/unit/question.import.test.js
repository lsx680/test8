'use strict';

/**
 * 单元测试：题库批量导入答案归一化（BUG-1 回归）
 * 需求追溯：REQ-QBM-05（批量导入，部分成功并返回 rowNo + reason）
 * 缺陷背景：修复前空答案列被 String(undefined) 变成字符串 "undefined"，被当作合法答案入库；
 *          修复后 undefined / null / 空白字符串统一归一为 []，并由题型校验器给出 20102。
 * 说明：question.model / knowledge.model / audit.model / db 全部 mock，不连接数据库。
 */
const questionModel = require('../../backend/src/models/question.model');
const knowledgeModel = require('../../backend/src/models/knowledge.model');
const auditModel = require('../../backend/src/models/audit.model');
const db = require('../../backend/src/config/db');
const questionService = require('../../backend/src/services/question.service');

jest.mock('../../backend/src/models/question.model');
jest.mock('../../backend/src/models/knowledge.model');
jest.mock('../../backend/src/models/audit.model');
jest.mock('../../backend/src/config/db');

const MOCK_CONN = { query: jest.fn() };
const BANK_ID = 10;
const TEACHER = { id: 2, roleCode: 'teacher' };
const YEAR = new Date().getUTCFullYear();

let idSequence;

beforeEach(() => {
  jest.clearAllMocks();
  idSequence = 100;
  questionModel.findBankById.mockResolvedValue({ id: BANK_ID, ownerId: TEACHER.id });
  questionModel.createQuestion.mockImplementation(async () => {
    idSequence += 1;
    return idSequence;
  });
  questionModel.addVersion.mockResolvedValue(1);
  questionModel.refreshBankQuestionCount.mockResolvedValue(1);
  auditModel.write.mockResolvedValue(true);
  db.queryValue.mockResolvedValue(0);
  db.withTransaction.mockImplementation(async (fn) => fn(MOCK_CONN));
});

/** 取出实际入库的题目载荷 */
function createdPayloads() {
  return questionModel.createQuestion.mock.calls.map(([payload]) => payload);
}

/** 断言任何入库载荷都不会出现字符串 "undefined"（BUG-1 的回归守护） */
function assertNoUndefinedString(payloads) {
  for (const payload of payloads) {
    expect(JSON.stringify(payload.correctAnswer)).not.toContain('undefined');
    expect(String(payload.correctAnswer)).not.toContain('undefined');
  }
}

describe('空答案归一化（BUG-1 核心）', () => {
  test('TC-QIM-001 CSV 空答案行不再以 "undefined" 入库，失败计数与行号正确', async () => {
    const rows = [
      { questionType: 'fill', stem: '三次握手的第二步', correctAnswer: 'SYN+ACK', defaultScore: 5 },
      { questionType: 'fill', stem: 'OSI 七层模型', correctAnswer: '应用层;表示层', defaultScore: 5 },
      { questionType: 'fill', stem: '未填答案的非法行', correctAnswer: undefined, defaultScore: 5 },
    ];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result).toMatchObject({
      totalRows: 3,
      successCount: 2,
      failureCount: 1,
    });
    // 表头占第 1 行，第三行数据对应 rowNo=4
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ rowNo: 4, reason: '填空题答案不能为空' });
    expect(result.importedQuestionIds).toHaveLength(2);

    const payloads = createdPayloads();
    expect(payloads).toHaveLength(2);
    assertNoUndefinedString(payloads);
    expect(payloads[0].correctAnswer).toEqual(['SYN+ACK']);
    expect(payloads[1].correctAnswer).toEqual(['应用层', '表示层']);
  });

  test('TC-QIM-002 null 答案同样归一为 [] 并失败', async () => {
    const rows = [{ questionType: 'fill', stem: 'null 答案', correctAnswer: null, defaultScore: 5 }];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.failures[0].reason).toBe('填空题答案不能为空');
    expect(questionModel.createQuestion).not.toHaveBeenCalled();
  });

  test('TC-QIM-003 纯空白答案（空格）trim 后归一为 [] 并失败', async () => {
    const rows = [{ questionType: 'fill', stem: '空白答案', correctAnswer: '   ', defaultScore: 5 }];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result.failureCount).toBe(1);
    expect(result.failures[0].reason).toBe('填空题答案不能为空');
    assertNoUndefinedString(createdPayloads());
  });

  test('TC-QIM-004 空字符串答案（被 pick 跳过）归一为 [] 并失败', async () => {
    const rows = [{ questionType: 'fill', stem: '空串答案', correctAnswer: '', defaultScore: 5 }];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result.failureCount).toBe(1);
    expect(questionModel.createQuestion).not.toHaveBeenCalled();
  });

  test('TC-QIM-005 简答题答案列留空仍合法（答案强制为 []，依赖采分点判分）', async () => {
    const rows = [{
      questionType: 'short',
      stem: '简述 TCP 三次握手',
      correctAnswer: '',
      scoringPoints: '[{"point":"描述 SYN","score":4}]',
      defaultScore: 10,
    }];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result).toMatchObject({ successCount: 1, failureCount: 0 });
    const [payload] = createdPayloads();
    expect(payload.correctAnswer).toEqual([]);
    expect(payload.scoringPoints).toEqual([{ point: '描述 SYN', score: 4 }]);
  });
});

describe('非空答案的题型归一化', () => {
  test('TC-QIM-010 填空题按中文/英文分号拆分并去除空格', async () => {
    const rows = [{
      questionType: 'fill',
      stem: '三次握手涉及的关键字',
      correctAnswer: ' SYN ； ACK ;FIN ',
      defaultScore: 5,
    }];

    await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(createdPayloads()[0].correctAnswer).toEqual(['SYN', 'ACK', 'FIN']);
  });

  test('TC-QIM-011 判断题答案大小写归一为 true/false', async () => {
    const rows = [
      { questionType: 'judge', stem: 'TCP 面向连接', correctAnswer: 'TRUE', defaultScore: 2 },
      { questionType: 'judge', stem: 'UDP 可靠传输', correctAnswer: 'False', defaultScore: 2 },
    ];

    await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    const payloads = createdPayloads();
    expect(payloads[0].correctAnswer).toEqual(['true']);
    expect(payloads[1].correctAnswer).toEqual(['false']);
  });

  test('TC-QIM-012 单选题/多选题答案按逗号拆分', async () => {
    const options = '[{"key":"A","content":"甲"},{"key":"B","content":"乙"},{"key":"C","content":"丙"}]';
    const rows = [
      { questionType: 'single', stem: '单选', options, correctAnswer: 'A', defaultScore: 2 },
      { questionType: 'multiple', stem: '多选', options, correctAnswer: 'A,B', defaultScore: 4 },
    ];

    await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    const payloads = createdPayloads();
    expect(payloads[0].correctAnswer).toEqual(['A']);
    expect(payloads[1].correctAnswer).toEqual(['A', 'B']);
    assertNoUndefinedString(payloads);
  });

  test('TC-QIM-013 JSON 数组形式的答案原样解析', async () => {
    const options = '[{"key":"A","content":"甲"},{"key":"B","content":"乙"}]';
    const rows = [{ questionType: 'multiple', stem: '多选', options, correctAnswer: '["A","B"]', defaultScore: 4 }];

    await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(createdPayloads()[0].correctAnswer).toEqual(['A', 'B']);
  });

  test('TC-QIM-014 多选答案只有 1 项时被校验器拒绝（20102）', async () => {
    const options = '[{"key":"A","content":"甲"},{"key":"B","content":"乙"}]';
    const rows = [{ questionType: 'multiple', stem: '多选', options, correctAnswer: 'A', defaultScore: 4 }];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result.failures[0].reason).toBe('多选题答案至少 2 项');
    expect(questionModel.createQuestion).not.toHaveBeenCalled();
  });
});

describe('部分成功与失败原因收集', () => {
  test('TC-QIM-020 合法行入库、非法行逐条记录原因，不阻断整批导入', async () => {
    const rows = [
      { questionType: 'single', stem: '合法单选', options: '[{"key":"A","content":"甲"},{"key":"B","content":"乙"}]', correctAnswer: 'A', defaultScore: 2 },
      { questionType: 'unknown', stem: '非法题型', correctAnswer: 'A', defaultScore: 2 },
      { stem: '缺题型', correctAnswer: 'A', defaultScore: 2 },
      { questionType: 'fill', stem: '', correctAnswer: 'x', defaultScore: 2 },
      { questionType: 'fill', stem: '难度越界', correctAnswer: 'x', difficulty: 9, defaultScore: 2 },
      { questionType: 'fill', stem: '分值为负', correctAnswer: 'x', defaultScore: -5 },
    ];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result).toMatchObject({ totalRows: 6, successCount: 1, failureCount: 5 });
    expect(result.failures.map((item) => item.rowNo)).toEqual([3, 4, 5, 6, 7]);
    expect(result.failures[0].reason).toBe('题型不合法');
    expect(result.failures[1].reason).toBe('题型不能为空');
    expect(result.failures[2].reason).toBe('题干不能为空');
    expect(result.failures[3].reason).toBe('难度必须为 1~5');
    expect(result.failures[4].reason).toBe('分值必须大于 0');
  });

  test('TC-QIM-021 options 非法 JSON 给出可读失败原因', async () => {
    const rows = [{ questionType: 'single', stem: '选项破损', options: '[{"key":', correctAnswer: 'A', defaultScore: 2 }];

    const result = await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(result.failures[0].reason).toBe('options 必须是合法 JSON');
  });

  test('TC-QIM-022 题号基于当年序号递增且互不重复', async () => {
    db.queryValue.mockResolvedValue(41);
    const rows = [
      { questionType: 'fill', stem: '题一', correctAnswer: 'a', defaultScore: 1 },
      { questionType: 'fill', stem: '题二', correctAnswer: 'b', defaultScore: 1 },
    ];

    await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    const questionNos = createdPayloads().map((payload) => payload.questionNo);
    expect(questionNos).toEqual([`Q-${YEAR}-000042`, `Q-${YEAR}-000043`]);
    expect(new Set(questionNos).size).toBe(questionNos.length);
  });

  test('TC-QIM-023 导入完成后写入审计并刷新题库题数', async () => {
    const rows = [{ questionType: 'fill', stem: '审计验证', correctAnswer: 'a', defaultScore: 1 }];

    await questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER });

    expect(questionModel.refreshBankQuestionCount).toHaveBeenCalledWith(BANK_ID, MOCK_CONN);
    expect(auditModel.write).toHaveBeenCalledWith(expect.objectContaining({
      module: 'qbm',
      action: 'question.import',
      requestSummary: expect.objectContaining({
        bankId: BANK_ID,
        totalRows: 1,
        successCount: 1,
        failureCount: 0,
      }),
    }), MOCK_CONN);
  });
});

describe('导入前置校验', () => {
  test('TC-QIM-030 超过 5000 行返回 20105 且不查库', async () => {
    const rows = new Array(5001).fill({ questionType: 'fill', stem: 'x', correctAnswer: 'a', defaultScore: 1 });

    await expect(questionService.importQuestions({ rows, bankId: BANK_ID, user: TEACHER }))
      .rejects.toMatchObject({ code: 20105, httpStatus: 400 });
    expect(questionModel.findBankById).not.toHaveBeenCalled();
  });

  test('TC-QIM-031 题库不存在返回 90401', async () => {
    questionModel.findBankById.mockResolvedValue(null);

    await expect(questionService.importQuestions({ rows: [], bankId: 999, user: TEACHER }))
      .rejects.toMatchObject({ code: 90401, httpStatus: 404 });
  });

  test('TC-QIM-032 非题库所有者且未被授权的教师导入返回 30108', async () => {
    const otherTeacher = { id: 99, roleCode: 'teacher' };
    questionModel.findBankAuthorization.mockResolvedValue(null);

    await expect(questionService.importQuestions({ rows: [], bankId: BANK_ID, user: otherTeacher }))
      .rejects.toMatchObject({ code: 30108, httpStatus: 403 });
  });
});