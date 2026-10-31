'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { fail } = require('../utils/errors');

/** 题目导入文件上传：内存存储，限 5MB，仅 .xlsx/.csv */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.xlsx', '.csv'].includes(ext)) {
      cb(fail(20104, { message: '仅支持 .xlsx 或 .csv 文件' }));
      return;
    }
    cb(null, true);
  },
});

module.exports = { upload };
// fs 引入保留：便于后续扩展磁盘存储
void fs;