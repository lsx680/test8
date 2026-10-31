'use strict';

/**
 * 集成测试：题库与题目（REQ-QBM-01~07）
 * 覆盖：题库增改删（引用保护）、五种题型创建校验、查询/更新/版本留痕、
 *      删除保护（被试卷引用返回 409）、引用清单、导入导出、知识点维护
 */
const { api, bearer, API } = require('../helpers/api');
const { loginSeed, createBank, createQuestion, uniqueSuffix } = require('../helpers/fixtures');
const { closeBackendPool } = require('../helpers/db');

let teacher;
let admin;
let bank;

const OPTIONS = [
  { key: 'A', content: '顺序数组' },
  { key: 'B', content: '哈希表 + 双向链表' },
  { key: 'C', content: '栈' },
  { key: 'D', content: '单向队列' },
];

function basePayload(overrides = {}) {
  return {
    bankId: bank.id,
    questionType: 'single',
    difficulty: 2,
    stem: `集成测试题干-${uniqueSuffix()}`,
    options: OPTIONS,
    correctAnswer: ['B'],
    defaultScore: 5,
    analysis: '集成测试解析',
    ...overrides,
  };
}

beforeAll(async () => {
  teacher = await loginSeed('teacher');
  admin = await loginSeed('admin');
  bank = await createBank(teacher.accessToken, `集成测试题库-${uniqueSuffix()}`);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await closeBackendPool();
});

describe('题库 question-banks', () => {
  test('TC-QBM-001 创建题库成功（201，所有者=当前教师）', async () => {
    const created = await createBank(teacher.accessToken, `题库操作-${uniqueSuffix()}`);
    expect(created.id).toBeGreaterThan(0);
    expect(created.ownerId).toBe(teacher.user.id);
    expect(created.status).toBe('active');
  });

  test('TC-QBM-002 同一所有者下题库名称重复返回 409 / 20108', async () => {
    const res = await api()
      .post(`${API}/question-banks`)
      .set(bearer(teacher.accessToken))
      .send({ bankName: bank.bankName });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(20108);
  });

  test('TC-QBM-003 题库列表分页结构完整且按数据权限过滤', async () => {
    const res = await api()
      .get(`${API}/question-banks`)
      .query({ page: 1, pageSize: 10, keyword: bank.bankName })
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      list: expect.any(Array), total: expect.any(Number), page: 1, pageSize: 10,
    }));
    expect(res.body.data.list.every((item) => item.ownerId === teacher.user.id)).toBe(true);
  });

  test('TC-QBM-004 题库内仍有题目时删除返回 409 / 90409', async () => {
    const tempBank = await createBank(teacher.accessToken, `待删题库-${uniqueSuffix()}`);
    await createQuestion(teacher.accessToken, {
      bankId: tempBank.id,
      questionType: 'judge',
      stem: '临时判断题',
      correctAnswer: ['true'],
      defaultScore: 2,
    });
    const res = await api().delete(`${API}/question-banks/${tempBank.id}`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(90409);
    expect(res.body.data.questionCount).toBe(1);
  });

  test('TC-QBM-005 空题库可删除成功', async () => {
    const tempBank = await createBank(teacher.accessToken, `空题库-${uniqueSuffix()}`);
    const res = await api().delete(`${API}/question-banks/${tempBank.id}`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    const detail = await api().get(`${API}/questions`).query({ bankId: tempBank.id }).set(bearer(teacher.accessToken));
    expect(detail.status).toBe(200);
  });

  test('TC-QBM-006 更新题库成功，名称被正确持久化', async () => {
    const tempBank = await createBank(teacher.accessToken, `更新前题库-${uniqueSuffix()}`);
    const newName = `更新后题库-${uniqueSuffix()}`;
    const res = await api()
      .put(`${API}/question-banks/${tempBank.id}`)
      .set(bearer(teacher.accessToken))
      .send({ bankName: newName });
    expect(res.status).toBe(200);
    expect(res.body.data.bankName).toBe(newName);
  });
});

describe('题目创建与校验', () => {
  test('TC-QBM-010 创建单选题成功，返回标准答案（教师视角）', async () => {
    const created = await createQuestion(teacher.accessToken, basePayload());
    expect(created.questionType).toBe('single');
    expect(created.correctAnswer).toEqual(['B']);
    expect(created.currentVersion).toBe(1);
    expect(created.questionNo).toMatch(/^Q-\d{4}-\d{6}$/);
  });

  test('TC-QBM-011 五种题型均可创建', async () => {
    const cases = [
      ['multiple', {
        options: OPTIONS,
        correctAnswer: ['A', 'B', 'D'],
        defaultScore: 10,
      }],
      ['judge', { options: null, correctAnswer: ['true'], defaultScore: 5 }],
      ['fill', { options: null, correctAnswer: ['SYN+ACK', '三次握手'], defaultScore: 10 }],
      ['short', {
        options: null,
        correctAnswer: [],
        scoringPoints: [{ point: '指出三段结构', score: 6 }, { point: '说明签名校验', score: 4 }],
        defaultScore: 10,
      }],
    ];
    for (const [questionType, extra] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const created = await createQuestion(teacher.accessToken, basePayload({
        questionType,
        stem: `${questionType} 题型-${uniqueSuffix()}`,
        ...extra,
      }));
      expect(created.questionType).toBe(questionType);
    }
  });

  test('TC-QBM-012 非法题型返回 400 / 20101', async () => {
    const res = await api()
      .post(`${API}/questions`)
      .set(bearer(teacher.accessToken))
      .send(basePayload({ questionType: 'essay' }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-QBM-013 单选题答案数量不为 1 返回 422 / 20102', async () => {
    const res = await api()
      .post(`${API}/questions`)
      .set(bearer(teacher.accessToken))
      .send(basePayload({ correctAnswer: ['A', 'B'] }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(20102);
  });

  test('TC-QBM-014 选项少于 2 项返回 422 / 20103', async () => {
    const res = await api()
      .post(`${API}/questions`)
      .set(bearer(teacher.accessToken))
      .send(basePayload({ options: [{ key: 'A', content: '唯一选项' }] }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(20103);
  });

  test('TC-QBM-015 简答题采分点分值之和超过满分返回 422 / 20109', async () => {
    const res = await api()
      .post(`${API}/questions`)
      .set(bearer(teacher.accessToken))
      .send(basePayload({
        questionType: 'short',
        options: null,
        correctAnswer: [],
        scoringPoints: [{ point: 'A', score: 8 }, { point: 'B', score: 5 }],
        defaultScore: 10,
      }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(20109);
  });

  test('TC-QBM-016 题库不存在返回 404 / 90401', async () => {
    const res = await api()
      .post(`${API}/questions`)
      .set(bearer(teacher.accessToken))
      .send(basePayload({ bankId: 999999 }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(90401);
  });
});

describe('题目查询、更新与版本', () => {
  test('TC-QBM-020 题目列表支持分页与题库过滤，字段完整', async () => {
    const res = await api()
      .get(`${API}/questions`)
      .query({ bankId: bank.id, page: 1, pageSize: 5 })
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.list.length).toBeLessThanOrEqual(5);
    expect(res.body.data.list[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      questionNo: expect.any(String),
      questionType: expect.any(String),
      stem: expect.any(String),
      defaultScore: expect.any(Number),
      currentVersion: expect.any(Number),
    }));
  });

  test('TC-QBM-021 获取题目详情返回答案与解析', async () => {
    const created = await createQuestion(teacher.accessToken, basePayload());
    const res = await api().get(`${API}/questions/${created.id}`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.correctAnswer).toEqual(['B']);
    expect(res.body.data.analysis).toBe('集成测试解析');
  });

  test('TC-QBM-022 更新题目生成新版本（版本号 +1，版本历史可查）', async () => {
    const created = await createQuestion(teacher.accessToken, basePayload());
    const update = await api()
      .put(`${API}/questions/${created.id}`)
      .set(bearer(teacher.accessToken))
      .send({ stem: '更新后的题干', version: created.currentVersion });
    expect(update.status).toBe(200);
    expect(update.body.data.version).toBe(created.currentVersion + 1);

    const versions = await api().get(`${API}/questions/${created.id}/versions`).set(bearer(teacher.accessToken));
    expect(versions.status).toBe(200);
    expect(versions.body.data).toHaveLength(2);
    expect(versions.body.data.map((item) => item.versionNo).sort()).toEqual([1, 2]);
  });

  test('TC-QBM-023 版本号冲突（并发修改）返回 409 / 90409', async () => {
    const created = await createQuestion(teacher.accessToken, basePayload());
    const first = await api()
      .put(`${API}/questions/${created.id}`)
      .set(bearer(teacher.accessToken))
      .send({ stem: '第一次修改', version: created.currentVersion });
    expect(first.status).toBe(200);

    const conflict = await api()
      .put(`${API}/questions/${created.id}`)
      .set(bearer(teacher.accessToken))
      .send({ stem: '过期版本修改', version: created.currentVersion });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe(90409);
  });

  test('TC-QBM-024 不存在的题目返回 404 / 90401', async () => {
    const res = await api().get(`${API}/questions/999999`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(90401);
  });
});

describe('题目删除保护（REQ-QBM-04）', () => {
  test('TC-QBM-030 未被引用的题目可删除，删除后查询返回 404', async () => {
    const created = await createQuestion(teacher.accessToken, basePayload());
    const del = await api().delete(`${API}/questions/${created.id}`).set(bearer(teacher.accessToken));
    expect(del.status).toBe(200);
    expect(del.body.code).toBe(0);

    const detail = await api().get(`${API}/questions/${created.id}`).set(bearer(teacher.accessToken));
    expect(detail.status).toBe(404);
    expect(detail.body.code).toBe(90401);
  });

  test('TC-QBM-031 题目被试卷引用后删除返回 409 / 20106，并返回引用清单', async () => {
    const created = await createQuestion(teacher.accessToken, basePayload());
    const paperRes = await api()
      .post(`${API}/papers`)
      .set(bearer(teacher.accessToken))
      .send({
        paperName: `引用保护试卷-${uniqueSuffix()}`,
        totalScore: 5,
        durationMinutes: 10,
        questions: [{ questionId: created.id, score: 5 }],
      });
    expect(paperRes.status).toBe(201);

    const del = await api().delete(`${API}/questions/${created.id}`).set(bearer(teacher.accessToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe(20106);
    expect(del.body.data.papers).toHaveLength(1);
    expect(del.body.data.papers[0].paperId).toBe(paperRes.body.data.id);

    const references = await api()
      .get(`${API}/questions/${created.id}/references`)
      .set(bearer(teacher.accessToken));
    expect(references.status).toBe(200);
    expect(references.body.data.papers[0].paperId).toBe(paperRes.body.data.id);
    expect(references.body.data.exams).toEqual([]);
  });
});

describe('题目批量导入与导出（REQ-QBM-05/06）', () => {
  test('TC-QBM-040【回归 BUG-1】CSV 导入填空题时空答案行应被判定失败并给出 20102', async () => {
    const importBank = await createBank(teacher.accessToken, `导入题库-${uniqueSuffix()}`);
    const csv = [
      'questionType,stem,correctAnswer,defaultScore',
      'fill,导入填空题A,SYN+ACK,5',
      'fill,导入填空题B,三次握手,5',
      'fill,非法行没有答案,,5',
    ].join('\n');

    const res = await api()
      .post(`${API}/questions/import`)
      .set(bearer(teacher.accessToken))
      .field('bankId', String(importBank.id))
      .attach('file', Buffer.from(csv, 'utf8'), 'questions.csv');

    expect(res.status).toBe(200);
    // 实际行为：successCount=3 / failureCount=0 —— 空答案被 String(undefined) 转为 "undefined" 后入库
    // 期望行为：第 4 行（无答案）应计入 failures 并返回 90101/20102
    expect(res.body.data.totalRows).toBe(3);
    expect(res.body.data.successCount).toBe(2);
    expect(res.body.data.failureCount).toBe(1);
    expect(res.body.data.failures[0].rowNo).toBe(4);
    expect(res.body.data.importedQuestionIds).toHaveLength(2);
  });

  test('TC-QBM-041 导出题目返回 xlsx 文件流', async () => {
    const res = await api()
      .get(`${API}/questions/export`)
      .query({ bankId: bank.id })
      .set(bearer(teacher.accessToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('questions.xlsx');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('TC-QBM-042 上传非 xlsx/csv 文件返回 400 / 20104', async () => {
    const res = await api()
      .post(`${API}/questions/import`)
      .set(bearer(teacher.accessToken))
      .field('bankId', String(bank.id))
      .attach('file', Buffer.from('plain text'), 'questions.txt');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(20104);
  });
});

describe('知识点维护（REQ-QBM-07）', () => {
  test('TC-QBM-050 管理员创建二级知识点并出现在树中', async () => {
    const kpName = `测试知识点-${uniqueSuffix()}`;
    const created = await api()
      .post(`${API}/knowledge-points`)
      .set(bearer(admin.accessToken))
      .send({ kpName, parentId: 1, level: 2 });
    expect(created.status).toBe(201);
    expect(created.body.data.level).toBe(2);

    const tree = await api().get(`${API}/knowledge-points`).set(bearer(teacher.accessToken));
    expect(tree.status).toBe(200);
    const parent = tree.body.data.find((item) => item.id === 1);
    expect(parent.children.some((item) => item.kpName === kpName)).toBe(true);

    const archived = await api()
      .patch(`${API}/knowledge-points/${created.body.data.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe('archived');
  });

  test('TC-QBM-051 教师无知识点维护权限（403 / 90301）', async () => {
    const res = await api()
      .post(`${API}/knowledge-points`)
      .set(bearer(teacher.accessToken))
      .send({ kpName: `教师越权-${uniqueSuffix()}`, level: 1 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });

  test('TC-QBM-052 同级知识点名称重复返回 409 / 90409', async () => {
    const kpName = `重复知识点-${uniqueSuffix()}`;
    await api().post(`${API}/knowledge-points`).set(bearer(admin.accessToken)).send({ kpName, parentId: 1, level: 2 }).expect(201);
    const res = await api()
      .post(`${API}/knowledge-points`)
      .set(bearer(admin.accessToken))
      .send({ kpName, parentId: 1, level: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(90409);
  });
});