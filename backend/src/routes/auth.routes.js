'use strict';

const express = require('express');
const controller = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { audit } = require('../middleware/audit');
const schemas = require('../validators/schemas');

const router = express.Router();

router.post('/register', authLimiter, validate({ body: schemas.register }), controller.register);
router.post('/login', authLimiter, validate({ body: schemas.login }), controller.login);
router.post('/refresh', authLimiter, validate({ body: schemas.refresh }), controller.refresh);

router.post('/logout', authenticate, authorize('auth.logout'), validate({ body: schemas.logout }), audit('uam', 'auth.logout'), controller.logout);
router.get('/me', authenticate, authorize('auth.me'), controller.me);
router.put('/profile', authenticate, authorize('auth.profile'), validate({ body: schemas.profile }), audit('uam', 'auth.profile'), controller.updateProfile);
router.put('/password', authenticate, authorize('auth.password'), validate({ body: schemas.changePassword }), audit('uam', 'auth.password'), controller.changePassword);

module.exports = router;