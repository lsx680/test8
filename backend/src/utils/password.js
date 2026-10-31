'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;

function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptRounds);
}

function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function isStrongPassword(plain) {
  return typeof plain === 'string' && PASSWORD_PATTERN.test(plain);
}

/** 管理员创建用户 / 重置密码时的一次性随机密码（12 位，含大小写字母、数字与符号） */
function generateTemporaryPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (set) => set[crypto.randomInt(0, set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { hashPassword, comparePassword, isStrongPassword, generateTemporaryPassword };