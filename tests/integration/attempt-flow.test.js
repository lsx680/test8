'use strict';

/**
 * 集成测试（核心链路）：在线答题 → 交卷 → 重复交卷幂等 → 人工阅卷 → 成绩发布 → 统计自洽
 * 需求追溯：REQ-EXM-03~08（开考/取题脱敏/暂存/计时/交卷/幂等）、
 *          REQ-MRK-02~05（人工阅卷/总分更新/发布）、REQ-STA-01~03（统计）
 *
 * 题目与分值（种子试卷）：
 *   1 单选 5 分（答案 B）、2 多选 10 分（A,B,D）、3 判断 5 分（true）、
 *   4 填空 10 分（SYN+ACK）、5 简答 20 分（人工阅卷）
 *   客观分合计 30，人工给 18 → 总分 48（及格线 30）
 */
const { api, login, bearer, API } = require('../helpers/api');
const {
  loginSeed, createStudent, createSeedPaper, lockPaper, createActiveExam,
  publishExam, startAttempt, uniqueSuffix,
} = require('../helpers/fixtures');
const { closeBackendPool } = require('../helpers/db');

const FORBIDDEN_FIELDS = ['correctAnswer', 'analysis', 'scoringPoints'];

let teacher;
let admin;
let student;
let studentLogin;
let outsider;
let paper;
let exam;
let attempt;
let gradingTaskId;
let firstSubmit;

beforeAll(async () => {
  teacher = await loginSeed('teacher');
  admin = await loginSeed('admin');
  const suffix = uniqueSuffix();

  student = await createStudent(admin.accessToken);
  studentLogin = await login(student.username, student.password);
  outsider = await createStudent(admin.accessToken);

  paper = await createSeedPaper(teacher.accessToken, `答题链路试卷-${suffix}`);
  await lockPaper(teacher.accessToken, paper.id);
  exam = await createActiveExam(teacher.accessToken, {
    paperId: paper.id,
    studentIds: [student.userId],
    examName: `答题链路考试-${suffix}`,
    passScore: 30,
  });
  await publishExam(teacher.accessToken, exam.id);

  // 开考一次，后续用例共享同一答卷（同一 describe 内按声明顺序执行）
  const started = await startAttempt(studentLogin.accessToken, exam.id);
  attempt = started.session;
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await closeBackendPool();
});

describe('开考与取题（REQ-EXM-03/04）', () => {
  test('TC-EXM-001 参考学生开考成功，返回答卷号/服务端时间/剩余时间', async () => {

    expect(attempt).toEqual(expect.objectContaining({
      attemptId: expect.any(Number),
      attemptNo: expect.any(String),
      examId: exam.id,
      status: 'ongoing',
      remainingSeconds: expect.any(Number),
      serverTime: expect.any(String),
      totalScore: expect.any(Number),
      questions: expect.any(Array),
    }));
    expect(attempt.remainingSeconds).toBeGreaterThan(0);
    expect(attempt.remainingSeconds).toBeLessThanOrEqual(30 * 60);
    expect(attempt.questions).toHaveLength(5);
  });

  test('TC-EXM-002 开考响应体不含 correctAnswer / analysis / scoringPoints 任一字段（REQ-EXM-04 脱敏）', async () => {
    const text = JSON.stringify(attempt);
    for (const field of FORBIDDEN_FIELDS) {
      expect(text).not.toContain(field);
    }
    expect(text).not.toContain('哈希表提供 O(1) 查找');
    expect(text).not.toContain('指出 Header、Payload、Signature 三部分');
  });

  test('TC-EXM-003 取题接口逐题校验字段白名单，绝不泄露答案（服务端强制脱敏）', async () => {
    const res = await api()
      .get(`${API}/attempts/${attempt.attemptId}/questions`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(5);

    for (const question of res.body.data.questions) {
      expect(Object.keys(question).sort()).toEqual([
        'answerSavedAt',
        'attemptQuestionId',
        'fullScore',
        'options',
        'orderNo',
        'questionId',
        'questionType',
        'stem',
        'studentAnswer',
      ]);
      for (const field of FORBIDDEN_FIELDS) {
        expect(question).not.toHaveProperty(field);
      }
      expect(question.stem.length).toBeGreaterThan(0);
    }

    const serialized = JSON.stringify(res.body);
    for (const field of FORBIDDEN_FIELDS) expect(serialized).not.toContain(field);
  });

  test('TC-EXM-004 重复开考幂等：返回同一答卷，不产生第二份', async () => {
    const again = await startAttempt(studentLogin.accessToken, exam.id);
    expect(again.status).toBe(200);
    expect(again.session.attemptId).toBe(attempt.attemptId);
    expect(again.session.attemptNo).toBe(attempt.attemptNo);
  });

  test('TC-EXM-005 非参考名单学生开考返回 403 / 40107', async () => {
    const outsiderLogin = await login(outsider.username, outsider.password);
    const res = await api()
      .post(`${API}/exams/${exam.id}/attempts`)
      .set(bearer(outsiderLogin.accessToken))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40107);
  });

  test('TC-EXM-006 教师开考返回 403（仅学生可开考）', async () => {
    const res = await api()
      .post(`${API}/exams/${exam.id}/attempts`)
      .set(bearer(teacher.accessToken))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });

  test('TC-EXM-007 剩余时间接口返回服务端权威时间与截止时间（REQ-EXM-05）', async () => {
    const res = await api()
      .get(`${API}/attempts/${attempt.attemptId}/remaining-time`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.remainingSeconds).toBeGreaterThan(0);
    expect(res.body.data.serverTime).toMatch(/Z$/);
    expect(res.body.data.deadlineAt).toBeTruthy();
    expect(typeof res.body.data.shouldAutoSubmit).toBe('boolean');
  });

  test('TC-EXM-008 断线恢复返回题目与已保存答案（初始为空）', async () => {
    const res = await api()
      .get(`${API}/attempts/${attempt.attemptId}`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(5);
    expect(res.body.data.questions.every((item) => item.studentAnswer === null)).toBe(true);
  });
});

describe('答案暂存 UPSERT 与乐观锁（REQ-EXM-06）', () => {
  test('TC-EXM-010 暂存 5 道题答案成功，返回 savedCount 与剩余时间', async () => {
    const answers = [
      { questionId: 1, answer: ['B'] },
      { questionId: 2, answer: ['A', 'B', 'D'] },
      { questionId: 3, answer: ['true'] },
      { questionId: 4, answer: ['syn + ack'] },
      { questionId: 5, answer: ['JWT 由 Header、Payload、Signature 三段组成，签名用于防篡改。'] },
    ];
    const res = await api()
      .put(`${API}/attempts/${attempt.attemptId}/answers`)
      .set(bearer(studentLogin.accessToken))
      .send({ answers });
    expect(res.status).toBe(200);
    expect(res.body.data.savedCount).toBe(5);
    expect(res.body.data.remainingSeconds).toBeGreaterThan(0);
  });

  test('TC-EXM-011 重复暂存同一答案幂等（UPSERT，不产生重复记录）', async () => {
    const res = await api()
      .put(`${API}/attempts/${attempt.attemptId}/answers`)
      .set(bearer(studentLogin.accessToken))
      .send({ answers: [{ questionId: 1, answer: ['B'] }] });
    expect(res.status).toBe(200);
    expect(res.body.data.savedCount).toBe(1);

    const questions = await api()
      .get(`${API}/attempts/${attempt.attemptId}/questions`)
      .set(bearer(studentLogin.accessToken));
    expect(questions.body.data.questions).toHaveLength(5);
    expect(questions.body.data.questions.find((item) => item.questionId === 1).studentAnswer).toEqual(['B']);
    expect(questions.body.data.questions.find((item) => item.questionId === 5).studentAnswer[0]).toContain('JWT');
  });

  test('TC-EXM-012 答案版本冲突返回 409 / 90409（乐观锁）', async () => {
    const res = await api()
      .put(`${API}/attempts/${attempt.attemptId}/answers`)
      .set(bearer(studentLogin.accessToken))
      .send({ answers: [{ questionId: 1, answer: ['A'], answerVersion: 0 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(90409);
    expect(res.body.data.questionId).toBe(1);
  });

  test('TC-EXM-013 提交不属于本答卷的题目返回 422 / 90101', async () => {
    const res = await api()
      .put(`${API}/attempts/${attempt.attemptId}/answers`)
      .set(bearer(studentLogin.accessToken))
      .send({ answers: [{ questionId: 999999, answer: ['A'] }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });

  test('TC-EXM-014 防作弊事件累计达到阈值后标记异常（REQ-EXM-09）', async () => {
    const first = await api()
      .post(`${API}/attempts/${attempt.attemptId}/cheat-events`)
      .set(bearer(studentLogin.accessToken))
      .send({ eventType: 'switch_screen', detail: { count: 1 } });
    expect(first.status).toBe(200);
    expect(first.body.data.cumulativeCount).toBe(1);
    expect(first.body.data.isAbnormal).toBe(false);

    const second = await api()
      .post(`${API}/attempts/${attempt.attemptId}/cheat-events`)
      .set(bearer(studentLogin.accessToken))
      .send({ eventType: 'switch_screen' });
    const third = await api()
      .post(`${API}/attempts/${attempt.attemptId}/cheat-events`)
      .set(bearer(studentLogin.accessToken))
      .send({ eventType: 'switch_screen' });

    expect(second.body.data.cumulativeCount).toBe(2);
    expect(third.body.data.cumulativeCount).toBe(3);
    expect(third.body.data.isAbnormal).toBe(true);

    const monitor = await api().get(`${API}/exams/${exam.id}/monitor`).set(bearer(teacher.accessToken));
    expect(monitor.status).toBe(200);
    expect(monitor.body.data).toEqual(expect.objectContaining({
      // 契约要求 integer；BUG-3 修复后实现已统一 Number(examId)，此处断言实际类型
      examId: exam.id,
      examName: exam.examName,
      totalStudents: expect.any(Number),
      doingCount: expect.any(Number),
      submittedCount: expect.any(Number),
      missedCount: expect.any(Number),
      abnormalCount: expect.any(Number),
      onlineRate: expect.any(Number),
      abnormalAttempts: expect.any(Array),
    }));
    expect(monitor.body.data.abnormalCount).toBeGreaterThanOrEqual(1);
    expect(typeof monitor.body.data.examId).toBe('number');
  });

  test('TC-EXM-015 非法事件类型返回 422 / 90101', async () => {
    const res = await api()
      .post(`${API}/attempts/${attempt.attemptId}/cheat-events`)
      .set(bearer(studentLogin.accessToken))
      .send({ eventType: 'unknown_event' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(90101);
  });
});

describe('交卷与幂等（REQ-EXM-07/08）', () => {
  test('TC-EXM-020 交卷成功：客观题得 30 分，主观题进入人工阅卷队列', async () => {
    const res = await api()
      .post(`${API}/attempts/${attempt.attemptId}/submit`)
      .set(bearer(studentLogin.accessToken))
      .send({ submitType: 'manual' });
    expect(res.status).toBe(200);
    firstSubmit = res.body.data;

    expect(firstSubmit.status).toBe('grading');
    expect(firstSubmit.objectiveScore).toBe(30);
    expect(firstSubmit.subjectiveScore).toBe(0);
    expect(firstSubmit.totalScore).toBe(30);
    expect(firstSubmit.pendingManualCount).toBe(1);
    expect(firstSubmit.gradingTaskId).toBeGreaterThan(0);
    expect(firstSubmit.replayed).toBe(false);
    gradingTaskId = firstSubmit.gradingTaskId;
  });

  test('TC-EXM-021 重复交卷返回 replayed=true 且分数与首次一致（幂等）', async () => {
    const res = await api()
      .post(`${API}/attempts/${attempt.attemptId}/submit`)
      .set(bearer(studentLogin.accessToken))
      .send({ submitType: 'manual' });
    expect(res.status).toBe(200);
    expect(res.body.data.replayed).toBe(true);
    expect(res.body.data.objectiveScore).toBe(firstSubmit.objectiveScore);
    expect(res.body.data.subjectiveScore).toBe(firstSubmit.subjectiveScore);
    expect(res.body.data.totalScore).toBe(firstSubmit.totalScore);
    expect(res.body.data.gradingTaskId).toBe(firstSubmit.gradingTaskId);
  });

  test('TC-EXM-022 交卷后禁止暂存答案（409 / 40109）', async () => {
    const res = await api()
      .put(`${API}/attempts/${attempt.attemptId}/answers`)
      .set(bearer(studentLogin.accessToken))
      .send({ answers: [{ questionId: 1, answer: ['A'] }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40109);
  });

  test('TC-EXM-023 交卷后禁止继续取题（409 / 40109）', async () => {
    const res = await api()
      .get(`${API}/attempts/${attempt.attemptId}/questions`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40109);
  });

  test('TC-EXM-024 作答次数用尽后再次开考返回 409 / 40108', async () => {
    const res = await api()
      .post(`${API}/exams/${exam.id}/attempts`)
      .set(bearer(studentLogin.accessToken))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(40108);
  });

  test('TC-EXM-025 交卷后断线重连可恢复答卷（不含题目）', async () => {
    const res = await api()
      .get(`${API}/attempts/${attempt.attemptId}`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('grading');
    expect(res.body.data.questions).toEqual([]);
  });
});

describe('人工阅卷与总分重算（REQ-MRK-03/05）', () => {
  test('TC-MRK-001 教师阅卷队列存在 1 条待阅任务，且详情返回学生答案与采分点', async () => {
    const list = await api()
      .get(`${API}/grading-tasks`)
      .query({ examId: exam.id })
      .set(bearer(teacher.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.pendingCount).toBe(1);
    expect(list.body.data.list[0].taskId).toBe(gradingTaskId);

    const detail = await api()
      .get(`${API}/grading-tasks/${gradingTaskId}`)
      .set(bearer(teacher.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toEqual(expect.objectContaining({
      taskId: gradingTaskId,
      attemptId: attempt.attemptId,
      questionType: 'short',
      fullScore: 20,
      status: 'pending',
      stem: expect.any(String),
      studentAnswer: expect.any(Array),
      scoringPoints: expect.any(Array),
    }));
  });

  test('TC-MRK-002 评分超出满分区间返回 422 / 50101', async () => {
    const res = await api()
      .post(`${API}/grading-tasks/${gradingTaskId}/score`)
      .set(bearer(teacher.accessToken))
      .send({ score: 21, comment: '越界评分' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(50101);
    expect(res.body.data.fullScore).toBe(20);
  });

  test('TC-MRK-003 采分点得分合计与总分不一致返回 422 / 50102', async () => {
    const res = await api()
      .post(`${API}/grading-tasks/${gradingTaskId}/score`)
      .set(bearer(teacher.accessToken))
      .send({
        score: 18,
        scoringPointScores: [{ point: '指出三段结构', score: 6 }, { point: '说明签名校验', score: 5 }],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(50102);
    expect(res.body.data.score).toBe(18);
  });

  test('TC-MRK-004 人工评分 18 分后总分由 30 更新为 48，阅卷状态完成', async () => {
    const res = await api()
      .post(`${API}/grading-tasks/${gradingTaskId}/score`)
      .set(bearer(teacher.accessToken))
      .send({ score: 18, comment: '结构完整，签名作用描述准确' });
    expect(res.status).toBe(200);
    expect(res.body.data.objectiveScore).toBe(30);
    expect(res.body.data.subjectiveScore).toBe(18);
    expect(res.body.data.totalScore).toBe(48);
    expect(res.body.data.isPassed).toBe(true);
    expect(res.body.data.gradingStatus).toBe('done');
  });

  test('TC-MRK-005 已完成的阅卷任务再次评分返回 409 / 50103', async () => {
    const res = await api()
      .post(`${API}/grading-tasks/${gradingTaskId}/score`)
      .set(bearer(teacher.accessToken))
      .send({ score: 10 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(50103);
  });

  test('TC-MRK-007 阅卷进度看板返回完成率', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/grading-progress`)
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      examId: exam.id, // 契约要求 integer；BUG-3 修复后返回 number
      totalAttempts: expect.any(Number),
      gradedAttempts: expect.any(Number),
      completionRate: expect.any(Number),
    }));
    expect(typeof res.body.data.examId).toBe('number');
    expect(res.body.data.completionRate).toBe(100);
  });

  test('TC-MRK-006 管理员重放自动判分不会覆盖人工分（客观 30 + 主观 18 = 48）', async () => {
    const res = await api()
      .post(`${API}/attempts/${attempt.attemptId}/grade`)
      .set(bearer(admin.accessToken))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.objectiveScore).toBe(30);
    expect(res.body.data.subjectiveScore).toBe(18);
    expect(res.body.data.totalScore).toBe(48);
  });

  test('TC-MRK-009【缺陷 BUG-2】重放自动判分后阅卷进度不应回退', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/grading-progress`)
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    // 期望：答卷已阅完（grading_status='done'），gradedAttempts=1、completionRate=100
    // 实际：管理员重放 autoGrade 将 grading_status 覆写为 'auto_done'，看板统计归零
    expect(res.body.data.gradedAttempts).toBe(1);
    expect(res.body.data.completionRate).toBe(100);
  });

  test('TC-MRK-008 学生无权访问阅卷接口（403 / 90301）', async () => {
    const res = await api()
      .get(`${API}/grading-tasks/${gradingTaskId}`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(90301);
  });
});

describe('成绩发布与明细自洽（REQ-STA-01/02、REQ-MRK-05）', () => {
  test('TC-STA-001 成绩未发布前学生查看明细返回 409 / 60101', async () => {
    const res = await api()
      .get(`${API}/my/grades/${attempt.attemptId}`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(60101);
  });

  test('TC-STA-002【缺陷 BUG-3】发布成绩成功，但响应 examId 应为整数（契约 integer）', async () => {
    const res = await api()
      .post(`${API}/exams/${exam.id}/publish-scores`)
      .set(bearer(teacher.accessToken))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.scoreStatus).toBe('published');
    expect(res.body.data.publishedAt).toEqual(expect.any(String));
    expect(res.body.data.notifiedCount).toBeGreaterThanOrEqual(1);
    // 契约（api-contract.yaml publishScores）声明 examId 为 integer；
    // 实际返回字符串 "2"，违反前后端类型约定。
    expect(typeof res.body.data.examId).toBe('number');
  });

  test('TC-STA-003 重复发布成绩返回 409 / 60102', async () => {
    const res = await api()
      .post(`${API}/exams/${exam.id}/publish-scores`)
      .set(bearer(teacher.accessToken))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(60102);
  });

  test('TC-STA-004 学生个人成绩列表显示已发布分数与排名', async () => {
    const res = await api()
      .get(`${API}/my/grades`)
      .query({ page: 1, pageSize: 20 })
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(200);
    const row = res.body.data.list.find((item) => item.attemptId === attempt.attemptId);
    expect(row).toBeTruthy();
    expect(row.scoreStatus).toBe('published');
    expect(row.totalScore).toBe(48);
    expect(row.classRank).toBeGreaterThanOrEqual(1);
  });

  test('TC-STA-005 成绩明细：总分 = 各题最终得分之和，客观分 + 主观分 = 总分', async () => {
    const res = await api()
      .get(`${API}/my/grades/${attempt.attemptId}`)
      .set(bearer(studentLogin.accessToken));
    expect(res.status).toBe(200);
    const detail = res.body.data;

    expect(detail.totalScore).toBe(48);
    expect(detail.objectiveScore).toBe(30);
    expect(detail.subjectiveScore).toBe(18);
    expect(detail.questions).toHaveLength(5);

    const sumFinal = detail.questions.reduce((sum, item) => sum + item.finalScore, 0);
    expect(sumFinal).toBeCloseTo(detail.totalScore, 2);
    expect(detail.objectiveScore + detail.subjectiveScore).toBeCloseTo(detail.totalScore, 2);

    const sumFullScore = detail.questions.reduce((sum, item) => sum + item.fullScore, 0);
    expect(sumFullScore).toBe(50);

    // 发布后可返回标准答案与解析（契约允许），且每题得分不超过满分
    for (const question of detail.questions) {
      expect(question.finalScore).toBeGreaterThanOrEqual(0);
      expect(question.finalScore).toBeLessThanOrEqual(question.fullScore);
    }
    expect(detail.questions.find((item) => item.questionId === 5).finalScore).toBe(18);
  });

  test('TC-STA-006 考试统计字段完整且数值自洽（平均分=48、提交率=100%）', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/statistics`)
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    const stat = res.body.data;

    expect(stat).toEqual(expect.objectContaining({
      examId: exam.id,
      examName: exam.examName,
      participantCount: expect.any(Number),
      submittedCount: expect.any(Number),
      absentCount: expect.any(Number),
      submitRate: expect.any(Number),
      avgScore: expect.any(Number),
      maxScore: expect.any(Number),
      minScore: expect.any(Number),
      stdDev: expect.any(Number),
      passCount: expect.any(Number),
      passRate: expect.any(Number),
      excellentCount: expect.any(Number),
      excellentRate: expect.any(Number),
      scoreDistribution: expect.any(Array),
      calculatedAt: expect.any(String),
    }));

    expect(stat.participantCount).toBe(1);
    expect(stat.submittedCount).toBe(1);
    expect(stat.absentCount).toBe(stat.participantCount - stat.submittedCount);
    expect(stat.submitRate).toBe(100);
    expect(stat.avgScore).toBe(48);
    expect(stat.maxScore).toBe(48);
    expect(stat.minScore).toBe(48);
    expect(stat.passCount).toBe(1);
    expect(stat.passRate).toBe(100);
    expect(stat.scoreDistribution).toHaveLength(5);
    expect(stat.scoreDistribution.reduce((sum, item) => sum + item.count, 0)).toBe(1);
    expect(stat.scoreDistribution.reduce((sum, item) => sum + item.ratio, 0)).toBeCloseTo(100, 2);
  });

  test('TC-STA-007 考试成绩列表包含学生学号/姓名/总分与班级排名', async () => {
    const res = await api()
      .get(`${API}/exams/${exam.id}/scores`)
      .set(bearer(teacher.accessToken));
    expect(res.status).toBe(200);
    const row = res.body.data.list[0];
    expect(row).toEqual(expect.objectContaining({
      attemptId: attempt.attemptId,
      studentNo: student.username,
      studentName: student.realName,
      totalScore: 48,
      objectiveScore: 30,
      subjectiveScore: 18,
      classRank: expect.any(Number),
    }));
  });

  test('TC-STA-008 学生申诉：成绩已发布可提交复核申请', async () => {
    const res = await api()
      .post(`${API}/appeals`)
      .set(bearer(studentLogin.accessToken))
      .send({ examId: exam.id, questionId: 5, reason: '请复核第 5 题采分点得分' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      status: 'pending',
      examId: exam.id,
    }));

    const duplicate = await api()
      .post(`${API}/appeals`)
      .set(bearer(studentLogin.accessToken))
      .send({ examId: exam.id, questionId: 5, reason: '重复申诉' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe(50108);
  });

  test('TC-STA-009 教师处理申诉（采纳并修正总分）后答卷状态为 reviewed', async () => {
    const list = await api()
      .get(`${API}/appeals`)
      .query({ examId: exam.id })
      .set(bearer(teacher.accessToken));
    expect(list.status).toBe(200);
    const appealId = list.body.data.list[0].id;

    const res = await api()
      .post(`${API}/appeals/${appealId}/handle`)
      .set(bearer(teacher.accessToken))
      .send({ status: 'accepted', comment: '经复核，第 5 题采分点补 2 分', newScore: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted');

    const detail = await api()
      .get(`${API}/my/grades/${attempt.attemptId}`)
      .set(bearer(studentLogin.accessToken));
    expect(detail.body.data.totalScore).toBe(50);
    expect(detail.body.data.isPassed).toBe(true);
  });
});