'use strict';

/**
 * Jest globalTeardown：仅打印结束提示。
 * 测试库保留（便于复现失败现场），下次运行时 globalSetup 会重建。
 */
async function globalTeardown() {
  // eslint-disable-next-line no-console
  console.log('[global-teardown] 测试执行结束；测试库 exam_system_test 已保留（下次运行将重建）');
}

module.exports = globalTeardown;