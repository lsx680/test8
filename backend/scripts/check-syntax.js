'use strict';

/**
 * 语法自检：遍历 src/**\/*.js 执行 node --check
 * 用法：npm run check
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../src');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath);
    else if (entry.endsWith('.js')) files.push(fullPath);
  }
}

walk(root);
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${path.relative(process.cwd(), file)}`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
  }
}
console.log(`node --check: ${files.length - failed}/${files.length} passed`);
if (failed > 0) process.exitCode = 1;