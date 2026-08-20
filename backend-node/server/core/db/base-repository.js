'use strict';

/**
 * Repository base class.
 *
 * Services depend on repositories, never on mongoose models directly. The
 * indirection buys two things worth the small ceremony: list endpoints share
 * one pagination/sort/filter implementation, and soft-deleted records are
 * excluded by default rather than by every caller remembering to.
 */

const AppError = require('../errors/AppError');
const { resolveListQuery } = require('../http/pagination');

class BaseRepository {
  /**
   * @param {import('mongoose').Model} model
   * @param {object} [options]
   * @param {string[]} [options.sortable]     Fields a caller may sort by.
   * @param {string[]} [options.filterable]   Fields a caller may filter by.
   * @param {string[]} [options.searchable]   Fields covered by `?q=`.
   * @param {boolean}  [options.softDelete=true]
   */
  constructor(model, options = {}) {
    this.model = model;
    this.sortable = options.sortable || ['createdAt', 'updatedAt'];
    this.filterable = options.filterable || [];
    this.searchable = options.searchable || [];
    this.softDelete = options.softDelete !== false;
  }

  /** Scoping applied to every read so deleted records stay invisible. */
  get baseFilter() {
    return this.softDelete ? { deletedAt: null } : {};
  }

  /**
   * @param {object} query    Validated list query.
   * @param {object} [extra]
   * @param {object} [extra.scope]     Additional mandatory filter.
   * @param {string} [extra.select]
   * @param {string|object} [extra.populate]
   */
  async list(query, extra = {}) {
    const { filter, sort, skip, limit, page } = resolveListQuery(query, {
      sortable: this.sortable,
      filterable: this.filterable,
      searchable: this.searchable,
      baseFilter: Object.assign({}, this.baseFilter, extra.scope || {})
    });

    let cursor = this.model.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true });
    if (extra.select) cursor = cursor.select(extra.select);
    if (extra.populate) cursor = cursor.populate(extra.populate);

    const [items, total] = await Promise.all([cursor.exec(), this.model.countDocuments(filter)]);

    return { items: items.map(normalizeLean), page, limit, total };
  }

  async findById(id, extra = {}) {
    let cursor = this.model.findOne(Object.assign({ _id: id }, this.baseFilter));
    if (extra.select) cursor = cursor.select(extra.select);
    if (extra.populate) cursor = cursor.populate(extra.populate);
    if (extra.session) cursor = cursor.session(extra.session);
    return cursor.exec();
  }

  /** Same as `findById` but raises 404 instead of returning null. */
  async findByIdOrFail(id, extra = {}) {
    const doc = await this.findById(id, extra);
    if (!doc) throw AppError.notFound(this.model.modelName);
    return doc;
  }

  async findOne(filter, extra = {}) {
    let cursor = this.model.findOne(Object.assign({}, this.baseFilter, filter));
    if (extra.select) cursor = cursor.select(extra.select);
    if (extra.populate) cursor = cursor.populate(extra.populate);
    if (extra.session) cursor = cursor.session(extra.session);
    return cursor.exec();
  }

  async exists(filter) {
    return Boolean(await this.model.exists(Object.assign({}, this.baseFilter, filter)));
  }

  async create(payload, { actorId, session } = {}) {
    const doc = new this.model(Object.assign({}, payload, { createdBy: actorId || null, updatedBy: actorId || null }));
    return doc.save({ session });
  }

  async updateById(id, payload, { actorId, session } = {}) {
    const doc = await this.findByIdOrFail(id, { session });
    doc.set(Object.assign({}, payload, { updatedBy: actorId || null }));
    return doc.save({ session });
  }

  async deleteById(id, { actorId, session } = {}) {
    const doc = await this.findByIdOrFail(id, { session });
    if (this.softDelete) {
      doc.deletedAt = new Date();
      doc.deletedBy = actorId || null;
      doc.updatedBy = actorId || null;
      return doc.save({ session });
    }
    return doc.deleteOne({ session });
  }

  async count(filter = {}) {
    return this.model.countDocuments(Object.assign({}, this.baseFilter, filter));
  }
}

/** `lean({ virtuals: true })` still leaves `_id`; align it with toJSON. */
function normalizeLean(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = Object.assign({}, doc);
  if (out._id) {
    out.id = String(out._id);
    delete out._id;
  }
  delete out.__v;
  return out;
}

module.exports = BaseRepository;
