'use strict';

const express = require('express');
const controller = require('../controllers/grade.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/schemas');

const router = express.Router();

/* 个人成绩 */
router.get('/my/grades', authenticate, authorize('grade.self'), controller.listMyGrades);
// 固定路径早于 :attemptId
router.get('/my/grades/export', authenticate, authorize('grade.self'), controller.exportMyGrades);
router.get('/my/grades/:attemptId', authenticate, authorize('grade.self'), controller.getMyGradeDetail);

/* 考试成绩 */
router.get('/exams/:examId/scores', authenticate, authorize('grade.exam'), controller.listExamScores);
router.get('/exams/:examId/scores/export', authenticate, authorize('grade.export'), controller.exportExamScores);
router.post('/exams/:examId/publish-scores', authenticate, authorize('grade.publish'), controller.publishScores);
router.get('/exams/:examId/statistics', authenticate, authorize('stat.exam'), controller.getStatistics);
router.get('/exams/:examId/question-analysis', authenticate, authorize('stat.question'), controller.getQuestionAnalysis);

/* 跨场次统计 */
router.get('/statistics/trends', authenticate, authorize('stat.trend'), controller.getTrends);
router.get('/statistics/knowledge-points', authenticate, authorize('stat.knowledge'), controller.getKnowledgePoints);

/* 复核申诉 */
router.get('/appeals', authenticate, controller.listAppeals);
router.post('/appeals', authenticate, authorize('appeal.create'), validate({ body: schemas.appealCreate }), controller.createAppeal);
router.post('/appeals/:appealId/handle', authenticate, authorize('appeal.handle'), validate({ body: schemas.appealHandle }), controller.handleAppeal);

module.exports = router;