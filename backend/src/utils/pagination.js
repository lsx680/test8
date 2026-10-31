'use strict';

/** 分页参数规范化：page≥1，pageSize 1~100，默认 20（设计文档 §5.3） */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1000;

function parsePagination(query = {}) {
  let page = Number.parseInt(query.page, 10);
  let pageSize = Number.parseInt(query.pageSize, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > MAX_PAGE) page = MAX_PAGE;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

function pageResult(list, total, { page, pageSize }, extra = {}) {
  return { list, total: Number(total) || 0, page, pageSize, ...extra };
}

module.exports = { parsePagination, pageResult };