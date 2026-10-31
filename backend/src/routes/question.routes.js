'use strict';

const express = require('express');
const controller = require('../controllers/question.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { upload } = require('../middleware/upload');
const schemas = require('../validators/schemas');

const router = express.Router();
// 该路由挂载在 /，仅对题库与题目前缀生效
router.use(['/question-banks', '/questions'], authenticate);

/* 题库 */
router.get('/question-banks', authorize('bank.read'), controller.listBanks);
router.post('/question-banks', authorize('bank.manage'), validate({ body: schemas.questionBank }), controller.createBank);
router.put('/question-banks/:bankId', authorize('bank.manage'), validate({ body: schemas.questionBank }), controller.updateBank);
router.delete('/question-banks/:bankId', authorize('bank.manage'), controller.deleteBank);
router.post('/question-banks/:bankId/authorizations', authorize('bank.manage'), validate({ body: schemas.bankAuthorization }), controller.authorizeBank);

/* 题目：固定路径必须在 :questionId 之前 */
router.get('/questions', authorize('question.read'), controller.listQuestions);
router.post('/questions', authorize('question.create'), validate({ body: schemas.questionCreate }), controller.createQuestion);
router.post('/questions/import', authorize('question.import'), upload.single('file'), controller.importQuestions);
router.get('/questions/export', authorize('question.export'), controller.exportQuestions);
router.get('/questions/:questionId', authorize('question.read'), controller.getQuestion);
router.put('/questions/:questionId', authorize('question.update'), validate({ body: schemas.questionUpdate }), controller.updateQuestion);
router.delete('/questions/:questionId', authorize('question.delete'), controller.deleteQuestion);
router.get('/questions/:questionId/versions', authorize('question.read'), controller.listVersions);
router.get('/questions/:questionId/references', authorize('question.read'), controller.getReferences);
router.post('/questions/:questionId/rejudge', authorize('question.rejudge'), validate({ body: schemas.rejudge }), controller.rejudge);

module.exports = router;