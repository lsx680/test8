'use strict';

const express = require('express');
const controller = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth');
const { authorize, requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const schemas = require('../validators/schemas');

const router = express.Router();

// 该路由挂载在 /，仅对下列前缀生效，避免拦截其它模块请求
router.use(['/users', '/roles', '/permissions', '/classes'], authenticate);

router.get('/users', authorize('user.list'), controller.listUsers);
router.post('/users', authorize('user.create'), validate({ body: schemas.userCreate }), controller.createUser);
// /pending 必须早于 /:userId
router.get('/users/pending', authorize('user.list'), controller.listPending);
router.get('/users/:userId', authorize('user.list'), controller.getUser);
router.put('/users/:userId', authorize('user.update'), validate({ body: schemas.userUpdate }), controller.updateUser);
router.patch('/users/:userId/status', authorize('user.status'), validate({ body: schemas.userStatus }), controller.updateStatus);
router.patch('/users/:userId/role', authorize('user.role'), validate({ body: schemas.userRole }), controller.updateRole);
router.post('/users/:userId/reset-password', authorize('user.resetPassword'), controller.resetPassword);
router.post('/users/:userId/approve', authorize('user.approve'), controller.approve);
router.post('/users/:userId/reject', authorize('user.approve'), validate({ body: schemas.rejectRegistration }), controller.reject);

router.get('/roles', controller.listRoles);
router.get('/permissions', controller.listPermissions);
router.get('/classes', controller.listClasses);
router.post('/classes', requireRole('admin'), validate({ body: schemas.classCreate }), controller.createClass);

module.exports = router;