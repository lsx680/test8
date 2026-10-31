'use strict';

/** 统计已注册端点数量（用于验收 102 个端点是否全部注册） */
const app = require('../src/app');

const endpoints = [];

function walk(stack, parent) {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((method) => method !== '_all');
      methods.forEach((method) => {
        endpoints.push(`${method.toUpperCase()} ${parent}${layer.route.path}`);
      });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      // 路由挂载前缀从 regexp 中提取（如 /api/v1 或子路由）
      const match = layer.regexp && layer.regexp.source
        ? layer.regexp.source
          .replace('^\\/', '/')
          .replace(/\\\/\?\(\?=\\\/\|\$\)/g, '')
          .replace(/\\\//g, '/')
          .replace(/\^/g, '')
          .replace(/\$$/g, '')
          .replace(/\(\?:\\\//g, '')
          .replace(/\)\?/g, '')
        : '';
      const prefix = match && match !== '/' ? match : '';
      walk(layer.handle.stack, `${parent}${prefix}`);
    }
  }
}

walk(app._router.stack, '');
// 根路由 /api/v1 由 index 显式注册，过滤掉非契约的健康探测
const contract = endpoints.filter((item) => item !== 'GET /api/v1/').filter((item) => item.includes('/api/v1') || item.includes('/auth') || item.includes('/papers')
  || item.includes('/users') || item.includes('/questions') || item.includes('/exams') || item.includes('/attempts')
  || item.includes('/grading-tasks') || item.includes('/statistics') || item.includes('/configs') || item.includes('/notices')
  || item.includes('/notifications') || item.includes('/backups') || item.includes('/appeals') || item.includes('/audit-logs')
  || item.includes('/my/grades') || item.includes('/roles') || item.includes('/permissions') || item.includes('/classes')
  || item.includes('/knowledge-points'));

console.log(`registered endpoints: ${contract.length}`);
contract.forEach((endpoint) => console.log(`  ${endpoint}`));
if (contract.length !== 102) {
  console.error(`WARN: expected 102 endpoints, got ${contract.length}`);
  process.exitCode = 1;
}