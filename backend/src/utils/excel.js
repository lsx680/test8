'use strict';

/**
 * Excel/CSV 读写工具（exceljs）
 * 导入：CSV 手工解析（支持引号转义），XLSX 用 exceljs 解析首张工作表
 * 导出：统一 xlsx 响应头，避免中文乱码
 */
const ExcelJS = require('exceljs');
const { fail } = require('./errors');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/**
 * 读取上传文件为对象数组（首行为表头）
 * @returns {Promise<Array<object>>}
 */
async function readTabular(buffer, originalName) {
  const lower = String(originalName || '').toLowerCase();
  if (lower.endsWith('.csv')) {
    const rows = parseCsv(buffer.toString('utf8'));
    if (rows.length === 0) return [];
    const headers = rows[0].map((h) => String(h).trim());
    return rows.slice(1).map((cells) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = cells[index] === undefined ? '' : String(cells[index]).trim();
      });
      return obj;
    });
  }
  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const headers = [];
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value === null || cell.value === undefined ? '' : cell.value).trim();
    });
    const result = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj = {};
      headers.forEach((header, colNumber) => {
        if (!header) return;
        const value = row.getCell(colNumber).value;
        if (value && typeof value === 'object' && value.text !== undefined) obj[header] = String(value.text).trim();
        else obj[header] = value === null || value === undefined ? '' : String(value).trim();
      });
      if (Object.values(obj).some((value) => value !== '')) result.push(obj);
    });
    return result;
  }
  throw fail(20104, { message: '仅支持 .xlsx 或 .csv 文件' });
}

/**
 * 输出 xlsx
 * @param {import('express').Response} res
 */
async function sendWorkbook(res, fileName, sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName || 'Sheet1');
  sheet.columns = columns.map((col) => ({ header: col.header, key: col.key, width: col.width || 18 }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  await workbook.xlsx.write(res);
  res.end();
}

/** CSV 输出（审计日志导出，契约要求 text/csv） */
function sendCsv(res, fileName, columns, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((col) => escape(col.header)).join(',')];
  rows.forEach((row) => lines.push(columns.map((col) => escape(row[col.key])).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.send(`\uFEFF${lines.join('\n')}`);
}

module.exports = { readTabular, sendWorkbook, sendCsv, parseCsv };