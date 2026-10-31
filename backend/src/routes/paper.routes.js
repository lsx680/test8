'use strict';

const express = require('express');
const controller = require('../controllers/paper.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/schemas');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('paper.read'), controller.listPapers);
router.post('/', authorize('paper.create'), validate({ body: schemas.paperCreate }), controller.createPaper);
// /random 必须早于 /:paperId
router.post('/random', authorize('paper.random'), validate({ body: schemas.randomPaper }), controller.randomAssemble);
router.get('/:paperId', authorize('paper.read'), controller.getPaper);
router.put('/:paperId', authorize('paper.update'), validate({ body: schemas.paperUpdate }), controller.updatePaper);
router.delete('/:paperId', authorize('paper.delete'), controller.deletePaper);
router.post('/:paperId/questions', authorize('paper.update'), validate({ body: schemas.paperQuestionAdd }), controller.addQuestions);
router.put('/:paperId/questions', authorize('paper.update'), validate({ body: schemas.paperQuestionUpdate }), controller.updateQuestions);
router.delete('/:paperId/questions/:paperQuestionId', authorize('paper.update'), controller.removeQuestion);
router.get('/:paperId/preview', authorize('paper.preview'), controller.preview);
router.post('/:paperId/copy', authorize('paper.copy'), validate({ body: schemas.paperCopy }), controller.copy);
router.patch('/:paperId/status', authorize('paper.status'), validate({ body: schemas.paperStatus }), controller.updateStatus);

module.exports = router;