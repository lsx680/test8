'use strict';

/**
 * 契约一致性测试：api-contract.yaml（102 operationId） ↔ 后端 Express 实际路由 ↔ 前端 API 模块
 * 目标：
 *   1. 契约中的每个 operationId / METHOD+PATH 在后端真实注册
 *   2. 后端不存在契约外的业务路由（允许根路径说明接口）
 *   3. 前端 11 个 API 模块引用的路径均以 /api/v1 为前缀且存在于契约
 *   4. 契约全部 operationId 均被前端注释/实现覆盖（防止联调遗漏）
 *
 * 若发现缺失，测试失败并在控制台输出缺失清单（报告中同步记录）。
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const confirm = require('../helpers/env');
const { app } = require('../helpers/api');

/* ------------------------------ 工具函数 ------------------------------ */

function normalizePath(input) {
  let value = String(input)
    .replace(/\$?\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\\\//g, '/');
  value = value.replace(/\/+$/, '');
  if (!value.startsWith('/')) value = `/${value}`;
  return value || '/';
}

/** 从 Express layer.regexp 提取挂载前缀；多前缀 use 返回 null */
function extractMountPrefix(layer) {
  const source = String((layer.regexp && layer.regexp.source) || '');
  if (!source) return '';
  if (source === '^\\/?(?=\\/|$)') return '';
  const trimmed = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '');
  if (trimmed.includes('|')) return null;
  return trimmed.replace(/\\\//g, '/');
}

function joinPath(prefix, subPath) {
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const right = subPath === '/' ? '' : (subPath.startsWith('/') ? subPath : `/${subPath}`);
  return normalizePath(`${left}${right}`);
}

/** 递归收集后端注册的 METHOD + PATH（Express 4 router stack） */
function collectRoutes(stack, prefix = '', out = []) {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {}).filter((method) => method !== '_all');
      for (const method of methods) {
        out.push({ method: method.toUpperCase(), path: joinPath(prefix, layer.route.path) });
      }
      continue;
    }
    if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
      const mount = extractMountPrefix(layer);
      if (mount !== null) collectRoutes(layer.handle.stack, joinPath(prefix, mount === '' ? '/' : mount), out);
    }
  }
  return out;
}

/** 解析契约：返回 [{ method, path, operationId, tag }] */
function loadContractOperations() {
  const doc = yaml.load(fs.readFileSync(confirm.apiContractPath, 'utf8'));
  const operations = [];
  for (const [contractPath, item] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(item || {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      operations.push({
        method: method.toUpperCase(),
        path: normalizePath(contractPath),
        operationId: operation.operationId || null,
        tag: (operation.tags || [])[0] || null,
      });
    }
  }
  return operations;
}

/** 提取前端模块中的请求路径（get/post/put/patch/del/http.get/http.post） */
function extractFrontendPaths(source) {
  const results = [];
  const pattern = /(?:^|[^.\w])(?:get|post|put|patch|del|http\.get|http\.post)\s*\(\s*(['"`])(\/[^'"`\n]*)\1/g;
  let match = pattern.exec(source);
  while (match) {
    const raw = match[2];
    results.push(raw);
    match = pattern.exec(source);
  }
  // 去重
  return [...new Set(results)];
}

const API_MODULE_FILES = [
  'http.js', 'auth.js', 'users.js', 'knowledge.js', 'questions.js',
  'papers.js', 'exams.js', 'attempts.js', 'reviews.js', 'stats.js', 'audit.js',
];

const contractOperations = loadContractOperations();
const contractSet = new Set(contractOperations.map((item) => `${item.method} ${item.path}`));
const backendRoutes = collectRoutes(app._router.stack);
const backendSet = new Set(backendRoutes.map((item) => `${item.method} ${normalizePath(item.path)}`));

afterAll(async () => {
  // eslint-disable-next-line global-require
  const { closeBackendPool } = require('../helpers/db');
  await closeBackendPool();
});

/* ------------------------------ 用例 ------------------------------ */

describe('契约规模与结构', () => {
  test('TC-CTR-001 契约包含 83 个路径 / 102 个 operationId', () => {
    const paths = new Set(contractOperations.map((item) => item.path));
    expect(paths.size).toBe(83);
    expect(contractOperations).toHaveLength(102);
    expect(contractOperations.filter((item) => !item.operationId)).toEqual([]);
  });

  test('TC-CTR-002 operationId 全局唯一', () => {
    const ids = contractOperations.map((item) => item.operationId);
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicated).toEqual([]);
  });

  test('TC-CTR-003 所有契约路径均以 /api/v1 为前缀', () => {
    const invalid = contractOperations.filter((item) => !item.path.startsWith('/api/v1'));
    expect(invalid).toEqual([]);
  });
});

describe('后端路由 ↔ 契约', () => {
  test('TC-CTR-010 后端实际注册路由数量不少于契约 operation 数', () => {
    expect(backendRoutes.length).toBeGreaterThanOrEqual(contractOperations.length);
    // eslint-disable-next-line no-console
    console.log(`[contract] 契约 operation=${contractOperations.length}，后端注册路由=${backendRoutes.length}`);
  });

  test('TC-CTR-011 契约中的每个 METHOD+PATH 在后端均已注册（输出缺失清单）', () => {
    const missing = contractOperations
      .filter((item) => !backendSet.has(`${item.method} ${item.path}`))
      .map((item) => `${item.method} ${item.path} (${item.operationId})`);
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[contract] 后端缺失端点 ${missing.length} 个：\n${missing.join('\n')}`);
    }
    expect(missing).toEqual([]);
  });

  test('TC-CTR-012 后端不存在契约外的业务路由（输出多余清单）', () => {
    const allowedExtra = new Set(['GET /api/v1']);
    const extra = backendRoutes
      .map((item) => `${item.method} ${normalizePath(item.path)}`)
      .filter((key) => !contractSet.has(key) && !allowedExtra.has(key));
    if (extra.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[contract] 契约外后端路由 ${extra.length} 个：\n${extra.join('\n')}`);
    }
    expect(extra).toEqual([]);
  });
});

describe('前端 API 模块静态检查', () => {
  const modules = API_MODULE_FILES.map((file) => ({
    file,
    fullPath: path.join(confirm.frontendApiDir, file),
    source: fs.existsSync(path.join(confirm.frontendApiDir, file))
      ? fs.readFileSync(path.join(confirm.frontendApiDir, file), 'utf8')
      : '',
  }));

  test('TC-CTR-020 前端 11 个 API 模块文件全部存在（含 http 基础模块）', () => {
    expect(modules).toHaveLength(11);
    expect(modules.filter((item) => item.source.length === 0)).toEqual([]);
  });

  test('TC-CTR-021 http.js 的 baseURL 默认值以 /api/v1 结尾', () => {
    const httpSource = modules.find((item) => item.file === 'http.js').source;
    expect(httpSource).toContain("'http://localhost:3000/api/v1'");
    expect(/API_BASE_URL\s*=/.test(httpSource)).toBe(true);
  });

  test('TC-CTR-022 前端引用的所有路径（拼接 baseURL 后）均存在于契约（输出未匹配清单）', () => {
    const unresolved = [];
    const referenced = new Set();
    for (const module of modules) {
      if (module.file === 'http.js') continue;
      for (const rawPath of extractFrontendPaths(module.source)) {
        const fullPath = normalizePath(`/api/v1${rawPath.split('?')[0]}`);
        const candidates = contractOperations.filter((item) => item.path === fullPath);
        if (candidates.length === 0) unresolved.push(`${module.file}: ${rawPath} -> ${fullPath}`);
        else referenced.add(fullPath);
      }
    }
    if (unresolved.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[contract] 前端路径未在契约中找到 ${unresolved.length} 个：\n${unresolved.join('\n')}`);
    }
    expect(unresolved).toEqual([]);
  });

  test('TC-CTR-023 契约的每个路径至少被一个前端 API 模块引用（输出未引用清单）', () => {
    const referenced = new Set();
    for (const module of modules) {
      if (module.file === 'http.js') continue;
      for (const rawPath of extractFrontendPaths(module.source)) {
        referenced.add(normalizePath(`/api/v1${rawPath.split('?')[0]}`));
      }
    }
    const uncovered = [...new Set(contractOperations.map((item) => item.path))]
      .filter((contractPath) => !referenced.has(contractPath));
    if (uncovered.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[contract] 前端未引用的契约路径 ${uncovered.length} 个：\n${uncovered.join('\n')}`);
    }
    expect(uncovered).toEqual([]);
  });

  test('TC-CTR-025 前端模块覆盖契约全部 102 个 operationId 注释', () => {
    const declared = new Set();
    for (const module of modules) {
      const block = module.source.match(/operationId：([\s\S]*?)(\*\/|$)/);
      if (!block) continue;
      (block[1].match(/[a-z][A-Za-z0-9]+/g) || []).forEach((id) => declared.add(id));
    }
    const contractIds = contractOperations.map((item) => item.operationId);
    const missing = contractIds.filter((id) => !declared.has(id));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[contract] 前端注释未声明的 operationId ${missing.length} 个：\n${missing.join('\n')}`);
    }
    expect(missing).toEqual([]);
  });
});