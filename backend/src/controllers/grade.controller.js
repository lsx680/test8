'use strict';

const gradeService = require('../services/grade.service');
const { sendWorkbook } = require('../utils/excel');
const { success, created, page } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.listMyGrades = asyncHandler(async (req, res) => page(res, await gradeService.listMyGrades(req.query, req.user)));

exports.exportMyGrades = asyncHandler(async (req, res) => {
  const rows = await gradeService.exportMyGrades(req.user);
  await sendWorkbook(res, 'my-grades.xlsx', '我的成绩', [
    { header: '考试名称', key: 'examName', width: 36 },
    { header: '交卷时间', key: 'submittedAt', width: 24 },
    { header: '成绩状态', key: 'scoreStatus', width: 12 },
    { header: '总分', key: 'totalScore', width: 10 },
    { header: '客观分', key: 'objectiveScore', width: 10 },
    { header: '主观分', key: 'subjectiveScore', width: 10 },
    { header: '是否及格', key: 'isPassedText', width: 10 },
    { header: '班级排名', key: 'classRank', width: 10 },
  ], rows.map((row) => ({
    ...row,
    isPassedText: row.isPassed === null ? '评阅中' : (row.isPassed ? '及格' : '不及格'),
    submittedAt: row.submittedAt ? new Date(row.submittedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
  })));
});

exports.getMyGradeDetail = asyncHandler(async (req, res) => success(res, await gradeService.getMyGradeDetail(req.params.attemptId, req.user)));

exports.listExamScores = asyncHandler(async (req, res) => page(res, await gradeService.listExamScores(req.params.examId, req.query, req.user)));

exports.exportExamScores = asyncHandler(async (req, res) => {
  const rows = await gradeService.exportExamScores(req.params.examId, req.query, req.user);
  await sendWorkbook(res, `exam-${req.params.examId}-scores.xlsx`, '考试成绩', [
    { header: '学号', key: 'studentNo', width: 16 },
    { header: '姓名', key: 'studentName', width: 12 },
    { header: '班级', key: 'className', width: 24 },
    { header: '总分', key: 'totalScore', width: 10 },
    { header: '客观分', key: 'objectiveScore', width: 10 },
    { header: '主观分', key: 'subjectiveScore', width: 10 },
    { header: '是否及格', key: 'isPassedText', width: 10 },
    { header: '班级排名', key: 'classRank', width: 10 },
    { header: '交卷时间', key: 'submittedAt', width: 24 },
  ], rows.map((row) => ({
    ...row,
    isPassedText: row.isPassed === null ? '未判分' : (row.isPassed ? '及格' : '不及格'),
    submittedAt: row.submittedAt ? new Date(row.submittedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
  })));
});

exports.publishScores = asyncHandler(async (req, res) => success(res, await gradeService.publishScores(req.params.examId, req.user)));

exports.getStatistics = asyncHandler(async (req, res) => success(res, await gradeService.getExamStatistics(req.params.examId, req.user)));

exports.getQuestionAnalysis = asyncHandler(async (req, res) => success(res, await gradeService.getQuestionAnalysis(req.params.examId, req.user)));

exports.getTrends = asyncHandler(async (req, res) => success(res, await gradeService.getTrendStatistics(req.query, req.user)));

exports.getKnowledgePoints = asyncHandler(async (req, res) => {
  if (!req.query.examId) {
    throw require('../utils/errors').fail(90101, { errors: [{ field: 'examId', message: 'examId 不能为空' }] });
  }
  return success(res, await gradeService.getKnowledgePointStatistics(Number(req.query.examId), req.user));
});

exports.listAppeals = asyncHandler(async (req, res) => page(res, await gradeService.listAppeals(req.query, req.user)));

exports.createAppeal = asyncHandler(async (req, res) => created(res, await gradeService.createAppeal(req.body, req.user)));

exports.handleAppeal = asyncHandler(async (req, res) => success(res, await gradeService.handleAppeal(req.params.appealId, req.body, req.user)));