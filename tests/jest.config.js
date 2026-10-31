'use strict';

const path = require('path');

/**
 * Jest 配置（OES 测试工程）
 * - testEnvironment=node：Supertest 直接驱动 Express app，无需监听端口
 * - maxWorkers=1：集成测试共享同一个测试库，串行执行避免数据竞争
 * - globalSetup：重建 exam_system_test 库并执行 docs/design/schema.sql（含种子账号）
 * - coverage：统计 backend/src 的覆盖率，输出到 tests/coverage，阈值 lines ≥ 60%
 *
 * 说明：rootDir 设为项目根，使 collectCoverageFrom 能覆盖 backend/src（Jest 默认
 * 只收集 rootDir 内的文件，若不提升 rootDir 会导致覆盖率为 0/0）。
 */
module.exports = {
  rootDir: path.resolve(__dirname, '..'),
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
    '<rootDir>/tests/contract/**/*.test.js',
  ],
  globalSetup: '<rootDir>/tests/helpers/global-setup.js',
  globalTeardown: '<rootDir>/tests/helpers/global-teardown.js',
  setupFiles: ['<rootDir>/tests/helpers/setup-env.js'],
  testTimeout: 60000,
  maxWorkers: 1,
  verbose: true,
  collectCoverageFrom: [
    '<rootDir>/backend/src/**/*.js',
    '!<rootDir>/backend/src/server.js',
  ],
  coverageProvider: 'v8', // babel 提供器在跨 rootDir 收集 backend 文件时失效，改用 V8
  coverageDirectory: '<rootDir>/tests/coverage',
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      lines: 60,
    },
  },
};