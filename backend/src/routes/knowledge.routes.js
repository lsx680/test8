'use strict';

const express = require('express');
const controller = require('../controllers/knowledge.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/schemas');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('kp.read'), controller.list);
router.post('/', authorize('kp.manage'), validate({ body: schemas.knowledgePoint }), controller.create);
router.put('/:kpId', authorize('kp.manage'), validate({ body: schemas.knowledgePoint }), controller.update);
router.patch('/:kpId/status', authorize('kp.manage'), validate({ body: schemas.knowledgePointStatus }), controller.updateStatus);

module.exports = router;