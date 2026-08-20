'use strict';

const Joi = require('joi');

const { listQuerySchema } = require('../../../core/http/pagination');
const { LEVELS } = require('../models/application-log.model');

const logQuerySchema = listQuerySchema.keys({
  level: Joi.string().valid(...LEVELS).optional(),
  // Prefix match, so `auth.` matches every authentication event.
  action: Joi.string().max(120).optional(),
  source: Joi.string().max(60).optional(),
  actorId: Joi.string().hex().length(24).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
});

const idParamSchema = Joi.object({
  id: Joi.string().hex().length(24).required()
});

const windowQuerySchema = Joi.object({
  // A day either side of the default covers "what just happened" and "what
  // did last week look like" without letting a caller aggregate a year.
  hours: Joi.number().integer().min(1).max(720).optional()
}).unknown(true);

module.exports = { logQuerySchema, idParamSchema, windowQuerySchema };
