'use strict';

/**
 * Schema factory that applies the platform's mandatory conventions.
 *
 * Applying these centrally rather than per model is what makes cross-cutting
 * guarantees real: every collection gets timestamps, soft delete, an audit
 * trail of who touched the record, an optimistic-concurrency version, and a
 * JSON shape that never leaks `_id`/`__v` or fields marked `select: false`.
 *
 *   const schema = createSchema({ name: { type: String, required: true } },
 *                               { collection: 'roles' });
 */

const mongoose = require('mongoose');

const DEFAULT_HIDDEN = ['__v', 'deletedAt', 'deletedBy'];

/**
 * @param {object} definition           Mongoose path definitions.
 * @param {object} [options]
 * @param {string} [options.collection]
 * @param {boolean} [options.softDelete=true]
 * @param {boolean} [options.audit=true]      Adds createdBy/updatedBy.
 * @param {string[]} [options.hidden]         Extra paths stripped from JSON.
 * @param {object} [options.schemaOptions]    Passed through to mongoose.
 */
function createSchema(definition, options = {}) {
  const {
    collection,
    softDelete = true,
    audit = true,
    hidden = [],
    schemaOptions = {}
  } = options;

  const paths = Object.assign({}, definition);

  if (audit) {
    paths.createdBy = { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null };
    paths.updatedBy = { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null };
  }

  if (softDelete) {
    // Records are never hard-deleted by default: audit and referential
    // history are worth more than the reclaimed space, and a retention job
    // purges them on the schedule the compliance policy defines.
    paths.deletedAt = { type: Date, default: null, index: true };
    paths.deletedBy = { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null };
  }

  const schema = new mongoose.Schema(
    paths,
    Object.assign(
      {
        collection,
        timestamps: true,
        versionKey: '__v',
        optimisticConcurrency: true,
        minimize: false,
        strict: 'throw',
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
      },
      schemaOptions
    )
  );

  const hiddenPaths = DEFAULT_HIDDEN.concat(hidden);

  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      for (const path of hiddenPaths) delete ret[path];
      return ret;
    }
  });

  if (softDelete) {
    schema.statics.findActive = function findActive(filter = {}, ...rest) {
      return this.find(Object.assign({ deletedAt: null }, filter), ...rest);
    };

    schema.statics.findOneActive = function findOneActive(filter = {}, ...rest) {
      return this.findOne(Object.assign({ deletedAt: null }, filter), ...rest);
    };

    schema.methods.softDelete = function softDeleteMethod(actorId) {
      this.deletedAt = new Date();
      this.deletedBy = actorId || null;
      return this.save();
    };

    schema.methods.restore = function restore() {
      this.deletedAt = null;
      this.deletedBy = null;
      return this.save();
    };
  }

  return schema;
}

module.exports = { createSchema };
