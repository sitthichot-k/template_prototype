'use strict';

/**
 * Shared list-query contract.
 *
 * Every collection endpoint accepts the same query parameters, which is what
 * lets the frontend data-table component work against any resource without
 * per-resource code:
 *
 *   ?page=1&limit=25&sort=-createdAt&q=alice&filter[status]=active
 */

const Joi = require('joi');

const MAX_LIMIT = 200;

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(25),
  sort: Joi.string().max(120).default('-createdAt'),
  q: Joi.string().trim().allow('').max(200).default(''),
  filter: Joi.object().pattern(Joi.string(), Joi.any()).default({})
}).unknown(true);

/**
 * Converts `sort=-createdAt,name` into a mongoose sort object, restricted to
 * an allowlist so a caller cannot force a scan on an unindexed field.
 *
 * @param {string} sort
 * @param {string[]} allowedFields
 */
function parseSort(sort, allowedFields) {
  const result = {};
  for (const token of String(sort || '').split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const direction = trimmed.startsWith('-') ? -1 : 1;
    const field = trimmed.replace(/^[-+]/, '');
    if (allowedFields.includes(field)) result[field] = direction;
  }
  return Object.keys(result).length ? result : { createdAt: -1 };
}

/**
 * Builds a mongoose filter from `filter[...]`, restricted to an allowlist.
 * Values starting with `$` are rejected outright to block operator injection.
 */
function parseFilter(filter, allowedFields) {
  const result = {};
  for (const [key, rawValue] of Object.entries(filter || {})) {
    if (!allowedFields.includes(key)) continue;
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    const value = Array.isArray(rawValue) ? rawValue : String(rawValue);

    if (Array.isArray(value)) {
      const safe = value.filter((item) => !String(item).startsWith('$'));
      if (safe.length) result[key] = { $in: safe };
      continue;
    }
    if (value.startsWith('$')) continue;
    if (value === 'true' || value === 'false') {
      result[key] = value === 'true';
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * Case-insensitive search across the given fields. Input is escaped so a
 * user-supplied string can never be interpreted as a regular expression.
 */
function parseSearch(term, searchableFields) {
  if (!term || !searchableFields.length) return null;
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'i');
  return { $or: searchableFields.map((field) => ({ [field]: pattern })) };
}

/**
 * Resolves a validated list query into the arguments a repository needs.
 *
 * @param {object} query           Output of `listQuerySchema`.
 * @param {object} options
 * @param {string[]} options.sortable
 * @param {string[]} options.filterable
 * @param {string[]} options.searchable
 * @param {object} [options.baseFilter]  Non-negotiable scoping, e.g. tenant.
 */
function resolveListQuery(query, { sortable = [], filterable = [], searchable = [], baseFilter = {} }) {
  const conditions = [baseFilter, parseFilter(query.filter, filterable)];
  const search = parseSearch(query.q, searchable);
  if (search) conditions.push(search);

  const nonEmpty = conditions.filter((c) => c && Object.keys(c).length);

  return {
    filter: nonEmpty.length > 1 ? { $and: nonEmpty } : nonEmpty[0] || {},
    sort: parseSort(query.sort, sortable),
    skip: (query.page - 1) * query.limit,
    limit: query.limit,
    page: query.page
  };
}

module.exports = { listQuerySchema, resolveListQuery, parseSort, parseFilter, parseSearch, MAX_LIMIT };
