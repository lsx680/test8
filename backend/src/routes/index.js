'use strict';

/** 路由汇总：所有接口统一前缀 /api/v1（102 个端点） */
const express = require('express');

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const knowledgeRoutes = require('./knowledge.routes');
const questionRoutes = require('./question.routes');
const paperRoutes = require('./paper.routes');
const examRoutes = require('./exam.routes');
const attemptRoutes = require('./attempt.routes');
const gradingRoutes = require('./grading.routes');
const statRoutes = require('./stat.routes');
const systemRoutes = require('./system.routes');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    code: 0,
    message: 'ok',
    data: { service: '在线考试系统 OES API', version: 'v1', serverTime: new Date().toISOString() },
  });
});

router.use('/auth', authRoutes);
router.use(userRoutes);
router.use('/knowledge-points', knowledgeRoutes);
router.use(questionRoutes);
router.use('/papers', paperRoutes);
router.use('/exams', examRoutes);
router.use('/attempts', attemptRoutes);
router.use(gradingRoutes);
router.use(statRoutes);
router.use(systemRoutes);

module.exports = router;