'use strict';

/** Express 应用装配：中间件顺序固定（设计文档 §3.1.2） */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const routes = require('./routes');
const { requestContext } = require('./middleware/requestContext');
const { notFound } = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((item) => item.trim()),
  credentials: false,
  exposedHeaders: ['X-Trace-Id', 'Content-Disposition'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.isProduction ? 'combined' : 'tiny', {
    skip: (req) => req.path === '/api/v1/health',
  }));
}
app.use(requestContext);

app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;