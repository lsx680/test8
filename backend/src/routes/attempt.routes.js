'use strict';

const express = require('express');
const controller = require('../controllers/attempt.controller');
const { authenticate } = require('../middleware/auth');
const { authorize, requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/schemas');

const router = express.Router();
router.use(authenticate);

router.get('/:attemptId', authorize('attempt.read'), controller.recover);
router.get('/:attemptId/questions', authorize('attempt.read'), controller.getQuestions);
router.get('/:attemptId/remaining-time', authorize('attempt.read'), controller.remainingTime);
router.put('/:attemptId/answers', authorize('attempt.answer'), validate({ body: schemas.saveAnswers }), controller.saveAnswers);
router.post('/:attemptId/cheat-events', authorize('attempt.cheat'), validate({ body: schemas.antiCheatEvent }), controller.reportCheatEvent);
router.post('/:attemptId/submit', authorize('attempt.submit'), validate({ body: schemas.submit }), controller.submit);
// 判分重放仅管理员（契约无对应权限点，按角色白名单控制）
router.post('/:attemptId/grade', requireRole('admin'), controller.grade);

module.exports = router;