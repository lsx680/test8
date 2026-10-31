'use strict';

const express = require('express');
const controller = require('../controllers/grading.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/schemas');

const router = express.Router();

router.get('/grading-tasks', authenticate, authorize('grading.read'), controller.listTasks);
router.get('/grading-tasks/:taskId', authenticate, authorize('grading.read'), controller.getTask);
router.post('/grading-tasks/:taskId/score', authenticate, authorize('grading.score'), validate({ body: schemas.scoreSubmit }), controller.score);
router.post('/grading-tasks/:taskId/arbitrate', authenticate, authorize('grading.arbitrate'), validate({ body: schemas.arbitrate }), controller.arbitrate);
router.get('/exams/:examId/grading-progress', authenticate, authorize('grading.progress'), controller.progress);

module.exports = router;