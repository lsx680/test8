'use strict';

const { ZodError } = require('zod');
const { validationError } = require('../utils/errors');

/**
 * zod 校验中间件
 * 用法：router.post('/', validate({ body: schema }), controller)
 * 校验通过后 req.body 被替换为解析后的值；query 放入 req.validatedQuery
 */
function formatIssues(error) {
  if (!(error instanceof ZodError)) return [];
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function validate(schemas = {}) {
  return (req, res, next) => {
    try {
      if (schemas.params) {
        req.validatedParams = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        req.validatedQuery = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body === undefined ? {} : req.body);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(validationError(formatIssues(err)));
        return;
      }
      next(err);
    }
  };
}

module.exports = { validate, formatIssues };