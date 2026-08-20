'use strict';

/**
 * Settings routes.
 *
 * Route-level guards are intentionally coarse (`/settings/*`, view/edit).
 * The real check is per-key, inside the controller, against each descriptor's
 * declared permission - because one request may span several settings groups.
 */

const express = require('express');
const Joi = require('joi');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const controller = require('../controllers/settings.controller');

const router = express.Router();

router.use(authenticate);

const updateSchema = Joi.object({
  scope: Joi.string().valid('global', 'organization', 'user').default('global'),
  scopeId: Joi.string().hex().length(24).allow(null).default(null),
  values: Joi.object().pattern(Joi.string(), Joi.any()).min(1).required()
});

router.get('/schema', controller.schema);
router.get('/values', controller.values);

// Connects outwards, so it is a POST and permission-checked in the controller
// against the same setting it exercises.
router.post('/mail/test', controller.testMail);
router.put('/', validate({ body: updateSchema }), controller.update);
router.delete(
  '/:key',
  validate({ params: Joi.object({ key: Joi.string().max(120).required() }) }),
  controller.reset
);

module.exports = router;
