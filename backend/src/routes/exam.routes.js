'use strict';

const express = require('express');
const controller = require('../controllers/exam.controller');
const attemptController = require('../controllers/attempt.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/schemas');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('exam.read'), controller.listExams);
router.post('/', authorize('exam.create'), validate({ body: schemas.examCreate }), controller.createExam);
// /available 必须早于 /:examId
router.get('/available', authorize('exam.available'), controller.listAvailable);
router.get('/:examId', authorize('exam.read'), controller.getExam);
router.put('/:examId', authorize('exam.update'), validate({ body: schemas.examUpdate }), controller.updateExam);
router.post('/:examId/publish', authorize('exam.publish'), controller.publishExam);
router.patch('/:examId/status', authorize('exam.change'), validate({ body: schemas.examStatus }), controller.updateStatus);
router.get('/:examId/tasks', authorize('exam.read'), controller.listTasks);
router.post('/:examId/grants', authorize('exam.grant'), validate({ body: schemas.examGrant }), controller.grantAttempts);
router.get('/:examId/monitor', authorize('exam.monitor'), controller.monitor);
router.get('/:examId/anti-cheat-events', authorize('exam.monitor'), controller.listAntiCheatEvents);

// 开考：POST /exams/{examId}/attempts
router.post('/:examId/attempts', authorize('attempt.start'), validate({ body: schemas.startAttempt }), attemptController.startAttempt);

module.exports = router;