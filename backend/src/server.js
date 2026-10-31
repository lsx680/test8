'use strict';

/** 服务启动入口：监听端口、注册进程内定时任务、优雅关闭 */
const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const attemptService = require('./services/attempt.service');

const TIMEOUT_JOB_INTERVAL_MS = 30 * 1000;
let timeoutTimer = null;

function startJobs() {
  if (env.nodeEnv === 'test') return;
  timeoutTimer = setInterval(async () => {
    try {
      const results = await attemptService.autoSubmitExpired();
      if (results.length > 0) {
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), msg: 'timeout.submit', results }));
      }
    } catch (err) {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), msg: 'timeout.job.failed', error: err.message }));
    }
  }, TIMEOUT_JOB_INTERVAL_MS);
  timeoutTimer.unref();
}

const server = app.listen(env.port, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    msg: 'server.started',
    port: env.port,
    env: env.nodeEnv,
    apiPrefix: '/api/v1',
  }));
  startJobs();
});

server.on('error', (err) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), msg: 'server.error', error: err.message }));
  process.exitCode = 1;
});

async function shutdown(signal) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), msg: 'server.shutdown', signal }));
  if (timeoutTimer) clearInterval(timeoutTimer);
  server.close(async () => {
    try {
      await db.close();
    } catch (err) {
      // 忽略关闭期连接池异常
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    msg: 'unhandledRejection',
    error: reason && reason.message ? reason.message : String(reason),
  }));
});

module.exports = server;