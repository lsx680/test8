'use strict';

/** Supertest 封装：直接驱动 Express app（不监听端口） */
const request = require('supertest');
const app = require('../../backend/src/app');

const API = '/api/v1';

function api() {
  return request(app);
}

/** 发送请求并断言 HTTP 200/201 且 code=0，返回 data */
async function ok(response) {
  const { status, body } = response;
  if (body && body.code !== 0) {
    throw new Error(`期望成功响应，实际 HTTP ${status} / code ${body.code}：${body.message}`);
  }
  return body ? body.data : null;
}

/** 登录并返回 data（accessToken/refreshToken/user/homeRoute） */
async function login(username, password) {
  const response = await api().post(`${API}/auth/login`).send({ username, password });
  if (response.status !== 200 || !response.body || response.body.code !== 0) {
    throw new Error(`登录失败（${username}）：HTTP ${response.status} / ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/** 带 token 的 Authorization 头 */
function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { app, api, ok, login, bearer, API };