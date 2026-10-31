'use strict';

/**
 * 集成测试：试卷与组卷（REQ-PPM-01~07）
 * 覆盖：手动组卷、分值校验、重复题目、随机组卷与缺口提示、预览脱敏、
 *      锁定后禁止改结构、复制、删除保护（被考试引用 409）、列表分页
 */
const { api, login, bearer, API } = require('../helpers/api');
const {
  loginSeed, createStudent, createTeacher, createSeedPaper, lockPaper,
  createActiveExam, uniqueSuffix, SEED_PAPER_ITEMS, SEED_PAPER_TOTAL_COVERAGE,
} = require('../helpers/fixtures');
const { closeBackendPool, closeConnection } = require('../helpers/db');

let teacher;
let admin;
let otherTeacher;
let student;

function paperPayload(overrides = {}) {
  return {
    paperName: `集成测试试卷-${uniqueSuffix()}`,
    description: '试卷集成测试',
    totalScore: SEED_PAPER_TOTAL_COVERAGE,
    durationMinutes: 30,
    questions: SEED_PAPER_ITEMS,
    ...overrides,
  };
}

beforeAll(async () => {
  teacher = await loginSeed('teacher');
  admin = await loginSeed('admin');
  const suffix = uniqueSuffix();
  const other = await createTeacher(admin.accessToken, suffix);
  otherTeacher = await login(other.username, other.password);
  student = await createStudent(admin.accessToken);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await closeBackendPool();
  await closeConnection();
});

describe('手动组卷（REQ-PPM-01）', () => {
  test('TC-PPM-001 手动组卷成功，分值校验通过且题目数正确', async () => {
    const res = await api().post(`${API}/papers`).set(bearer(teacher.accessToken)).send(paperPayload());
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    const paper = res.body.data;
    expect(paper.assemblyMode).toBe('manual');
    expect(paper.questionCount).toBe(SEED_PAPER_ITEMS.length);
    expect(paper.totalScore).toBe(SEED_PAPER_TOTAL_COVERAGE);
    expect(paper.questions).toHaveLength(SEED_PAPER_ITEMS.length);
    expect(paper.scoreCheck).toMatchObject({
      expectedTotal: SEED_PAPER_TOTAL_COVERAGE,
      actualSum: SEED_PAPER_TOTAL_COVERAGE,
      matched: true,
    });
  });

  test('TC-PPM-002 各题分值之和不等于总分返回 422 / 30101，并给出差额', async () => {
    const res = await api()
      .post(`${API}/papers`)
      .set(bearer(teacher.accessToken))
      .send(paperPayload({ totalScore: 100 }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(30101);
    expect(res.body.data).toMatchObject({
      expectedTotal: 100,
      actualSum: SEED_PAPER_TOTAL_COVERAGE,
      difference: 100 - SEED_PAPER_TOTAL_COVERAGE,
    });
  });

  test('TC-PPM-003 试卷至少需要 1 道题（422 / 90101）', async () => {
    const res = await api()
      .post(`${API}/papers`)
      .set(bearer(teacher.accessToken))
      .send(paperPayload({ totalScore: 10, questions: [] }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-PPM-004 同一试卷不允许重复引用题目（409 / 30105）', async () => {
    const res = await api()
      .post(`${API}/papers`)
      .set(bearer(teacher.accessToken))
      .send(paperPayload({
        totalScore: 10,
        questions: [{ questionId: 1, score: 5 }, { questionId: 1, score: 5 }],
      }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(30105);
  });

  test('TC-PPM-005 引用他人题库题目返回 403 / 30108（数据权限）', async () => {
    const res = await api()
      .post(`${API}/papers`)
      .set(bearer(otherTeacher.accessToken))
      .send(paperPayload({
        totalScore: 5,
        questions: [{ questionId: 1, score: 5 }],
      }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(30108);
  });
});

describe('随机组卷（REQ-PPM-02）', () => {
  test('TC-PPM-010 按规则随机抽题成功，卷面分值与规则一致', async () => {
    const res = await api()
      .post(`${API}/papers/random`)
      .set(bearer(teacher.accessToken))
      .send({
        paperName: `随机试卷-${uniqueSuffix()}`,
        totalScore: 5,
        durationMinutes: 20,
        bankIds: [1],
        rules: [{ questionType: 'single', count: 1, scorePerQuestion: 5 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.questionCount).toBe(1);
    expect(res.body.data.totalScore).toBe(5);
    expect(res.body.data.questions[0].questionType).toBe('single');
    expect(res.body.data.shortages).toEqual([]);
  });

  test('TC-PPM-011 可用题目不足返回 409 / 30107，并给出缺口清单', async () => {
    const res = await api()
      .post(`${API}/papers/random`)
      .set(bearer(teacher.accessToken))
      .send({
        paperName: `缺题随机试卷-${uniqueSuffix()}`,
        totalScore: 50,
        durationMinutes: 20,
        bankIds: [1],
        rules: [{ questionType: 'short', count: 50, scorePerQuestion: 1 }],
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(30107);
    expect(res.body.data.shortages.length).toBeGreaterThan(0);
    expect(res.body.data.shortages[0].shortageCount).toBeGreaterThan(0);
  });

  test('TC-PPM-012 随机组卷规则分值之和与总分不一致返回 422 / 30101', async () => {
    const res = await api()
      .post(`${API}/papers/random`)
      .set(bearer(teacher.accessToken))
      .send({
        paperName: `分值不符随机试卷-${uniqueSuffix()}`,
        totalScore: 20,
        durationMinutes: 20,
        bankIds: [1],
        rules: [{ questionType: 'single', count: 1, scorePerQuestion: 5 }],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(30101);
    expect(res.body.data.actualSum).toBe(5);
  });

  test('TC-PPM-013 难度占比之和不为 1 返回 422 / 90101', async () => {
    const res = await api()
      .post(`${API}/papers/random`)
      .set(bearer(teacher.accessToken))
      .send({
        paperName: `难度占比非法-${uniqueSuffix()}`,
        totalScore: 5,
        durationMinutes: 20,
        bankIds: [1],
        rules: [{ questionType: 'single', count: 1, scorePerQuestion: 5, difficultyDistribution: { 2: 0.5 } }],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-PPM-014 saveDraft=false 时仅返回抽题结果，不落库', async () => {
    const res = await api()
      .post(`${API}/papers/random`)
      .set(bearer(teacher.accessToken))
      .send({
        paperName: `预览随机试卷-${uniqueSuffix()}`,
        totalScore: 5,
        durationMinutes: 20,
        bankIds: [1],
        saveDraft: false,
        rules: [{ questionType: 'single', count: 1, scorePerQuestion: 5 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.paperId).toBeNull();
    expect(res.body.data.questions).toHaveLength(1);
  });
});

describe('试卷预览与查询（脱敏）', () => {
  test('TC-PPM-020 试卷详情包含 scoreCheck 且题目不泄露答案与解析', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `预览试卷-${uniqueSuffix()}`);
    const res = await api().get(`${API}/papers/${paper.id}`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.scoreCheck.matched).toBe(true);

    const text = JSON.stringify(res.body.data.questions);
    expect(text).not.toContain('correctAnswer');
    expect(text).not.toContain('analysis');
    expect(text).not.toContain('哈希表提供 O(1) 查找');
  });

  test('TC-PPM-021 试卷预览接口只返回展示字段且不含标准答案', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `预览接口试卷-${uniqueSuffix()}`);
    const res = await api().get(`${API}/papers/${paper.id}/preview`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      paperId: paper.id,
      paperName: paper.paperName,
      totalScore: SEED_PAPER_TOTAL_COVERAGE,
      durationMinutes: 30,
      questions: expect.any(Array),
    }));
    const text = JSON.stringify(res.body.data.questions);
    expect(text).not.toContain('correctAnswer');
    expect(text).not.toContain('scoringPoints');
    expect(text).not.toContain('analysis');
  });

  test('TC-PPM-022 试卷列表分页结构与数据权限', async () => {
    const res = await api()
      .get(`${API}/papers`)
      .query({ page: 1, pageSize: 5, keyword: '试卷' })
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      list: expect.any(Array), total: expect.any(Number), page: 1, pageSize: 5,
    }));
    expect(res.body.data.list.every((item) => item.ownerId === teacher.user.id)).toBe(true);
  });
});

describe('试卷编辑、锁定与删除保护（REQ-PPM-03/04/06）', () => {
  test('TC-PPM-030 草稿试卷可修改名称与说明', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `可编辑试卷-${uniqueSuffix()}`);
    const newName = `已改名试卷-${uniqueSuffix()}`;
    const res = await api()
      .put(`${API}/papers/${paper.id}`)
      .set(bearer(teacher.accessToken))
      .send({ paperName: newName, description: '修改说明' });
    expect(res.status).toBe(200);

    const detail = await api().get(`${API}/papers/${paper.id}`).set(bearer(teacher.accessToken));
    expect(detail.body.data.paperName).toBe(newName);
    expect(detail.body.data.description).toBe('修改说明');
  });

  test('TC-PPM-031 试卷锁定后修改总分返回 409 / 30103', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `锁定试卷-${uniqueSuffix()}`);
    await lockPaper(teacher.accessToken, paper.id);

    const res = await api()
      .put(`${API}/papers/${paper.id}`)
      .set(bearer(teacher.accessToken))
      .send({ totalScore: 60 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(30103);
  });

  test('TC-PPM-032 试卷锁定后禁止添加题目（409 / 30103）', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `锁定加题试卷-${uniqueSuffix()}`);
    await lockPaper(teacher.accessToken, paper.id);

    const res = await api()
      .post(`${API}/papers/${paper.id}/questions`)
      .set(bearer(teacher.accessToken))
      .send({ questions: [{ questionId: 1, score: 5 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(30103);
  });

  test('TC-PPM-033 试卷状态非法返回 422 / 90101', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `状态非法试卷-${uniqueSuffix()}`);
    const res = await api()
      .patch(`${API}/papers/${paper.id}/status`)
      .set(bearer(teacher.accessToken))
      .send({ status: 'deleted' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-PPM-034 复制试卷生成独立新卷（题目数与总分一致）', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `复制源试卷-${uniqueSuffix()}`);
    const res = await api()
      .post(`${API}/papers/${paper.id}/copy`)
      .set(bearer(teacher.accessToken))
      .send({ paperName: `复制目标试卷-${uniqueSuffix()}` });
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(paper.id);
    expect(res.body.data.questionCount).toBe(paper.questionCount);
    expect(res.body.data.status).toBe('draft');
  });

  test('TC-PPM-035 试卷被考试引用后删除返回 409 / 30106', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `被引用试卷-${uniqueSuffix()}`);
    const examRes = await api()
      .post(`${API}/exams`)
      .set(bearer(teacher.accessToken))
      .send({
        examName: `引用试卷的考试-${uniqueSuffix()}`,
        paperId: paper.id,
        startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        durationMinutes: 30,
        scope: { studentIds: [student.userId] },
      });
    expect(examRes.status).toBe(201);

    const del = await api().delete(`${API}/papers/${paper.id}`).set(bearer(teacher.accessToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe(30106);
  });

  test('TC-PPM-036 未被引用的试卷可删除', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `可删试卷-${uniqueSuffix()}`);
    const del = await api().delete(`${API}/papers/${paper.id}`).set(bearer(teacher.accessToken));
    expect(del.status).toBe(200);

    const detail = await api().get(`${API}/papers/${paper.id}`).set(bearer(teacher.accessToken));
    expect(detail.status).toBe(404);
    expect(detail.body.code).toBe(90401);
  });

  test('TC-PPM-037 其他教师删除他人试卷返回 403 / 90302', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `他人试卷-${uniqueSuffix()}`);
    const res = await api().delete(`${API}/papers/${paper.id}`).set(bearer(otherTeacher.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90302);
  });
});

describe('考试引用试卷的状态约束', () => {
  test('TC-PPM-040 使用归档试卷创建考试返回 409 / 30104', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `归档试卷-${uniqueSuffix()}`);
    const archive = await api()
      .patch(`${API}/papers/${paper.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: 'archived' });
    expect(archive.status).toBe(200);

    const res = await api()
      .post(`${API}/exams`)
      .set(bearer(teacher.accessToken))
      .send({
        examName: `归档卷考试-${uniqueSuffix()}`,
        paperId: paper.id,
        startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        durationMinutes: 30,
        scope: { studentIds: [student.userId] },
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(30104);
  });

  test('TC-PPM-041 创建考试时自动锁定试卷；异常状态下发布返回 409 / 40112', async () => {
    const paper = await createSeedPaper(teacher.accessToken, `未锁试卷-${uniqueSuffix()}`);
    const exam = await createActiveExam(teacher.accessToken, {
      paperId: paper.id,
      studentIds: [student.userId],
      examName: `未锁卷考试-${uniqueSuffix()}`,
    });

    // 创建考试会触发引用计数并将 draft 试卷自动置为 locked（见 paper.model.incrementUsedCount）
    const afterCreate = await api().get(`${API}/papers/${paper.id}`).set(bearer(teacher.accessToken));
    expect(afterCreate.body.data.usedCount).toBe(1);
    expect(afterCreate.body.data.status).toBe('locked');

    // 构造异常前置状态：试卷被外部改回 draft 时，发布考试必须拒绝（REQ-EXM-02 发布前必须锁定）
    // eslint-disable-next-line global-require
    await require('../helpers/db').sql('UPDATE pp_paper SET status = ? WHERE id = ?', ['draft', paper.id]);

    const res = await api().post(`${API}/exams/${exam.id}/publish`).set(bearer(teacher.accessToken));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40112);
  });
});