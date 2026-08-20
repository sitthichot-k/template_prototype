'use strict';

/**
 * Request validation middleware built on Joi.
 *
 * Validation happens at the edge and the validated value REPLACES the raw
 * input. Controllers therefore never see unvalidated data, and mass-assignment
 * is structurally impossible: a key absent from the schema is stripped before
 * the handler runs.
 *
 *   router.post('/users',
 *     validate({ body: createUserSchema }),
 *     controller.create);
 */

const AppError = require('../errors/AppError');

const TARGETS = ['body', 'query', 'params', 'headers'];

function formatDetails(joiError) {
  const details = {};
  for (const item of joiError.details) {
    const key = item.path.join('.') || '_';
    if (!details[key]) details[key] = [];
    details[key].push(item.message);
  }
  return details;
}

/**
 * @param {{ body?: import('joi').Schema, query?: import('joi').Schema,
 *           params?: import('joi').Schema, headers?: import('joi').Schema }} schemas
 */
function validate(schemas) {
  const active = TARGETS.filter((target) => schemas[target]);

  return function validateMiddleware(req, res, next) {
    for (const target of active) {
      const { value, error } = schemas[target].validate(req[target], {
        abortEarly: false,
        stripUnknown: target !== 'headers',
        convert: true
      });

      if (error) {
        return next(AppError.validation(formatDetails(error), `Invalid request ${target}.`));
      }

      // `req.query` and `req.params` are getter-only in Express 5 and
      // read-only in some proxies; assigning to a shadow property keeps this
      // forward compatible.
      if (target === 'query' || target === 'params') {
        Object.defineProperty(req, target, { value, writable: true, configurable: true });
      } else {
        req[target] = value;
      }
    }
    return next();
  };
}

module.exports = validate;
