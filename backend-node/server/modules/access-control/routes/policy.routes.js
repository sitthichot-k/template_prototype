'use strict';

const express = require('express');
const Joi = require('joi');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/policy.controller');
const schemas = require('../validators');

const router = express.Router();
const RESOURCE = '/security/policies';

router.use(authenticate);

router.get('/', requirePermission(RESOURCE, 'view'), validate({ query: schemas.listQuerySchema }), controller.list);

router.post('/', requirePermission(RESOURCE, 'create'), validate({ body: schemas.policySchema }), controller.create);

router.post(
  '/simulate',
  requirePermission(RESOURCE, 'view'),
  validate({
    body: Joi.object({
      userId: schemas.objectId.required(),
      resource: Joi.string().required(),
      action: Joi.string().required(),
      context: Joi.object().default({})
    })
  }),
  controller.simulate
);

// Creating rules, so it is guarded by `create` rather than `edit`. Declared
// before `/:id` for readability; the paths cannot collide because that route
// is a GET.
router.post('/seed-defaults', requirePermission(RESOURCE, 'create'), controller.seedDefaults);

router.get('/:id', requirePermission(RESOURCE, 'view'), validate({ params: schemas.idParamSchema }), controller.getOne);

router.patch(
  '/:id',
  requirePermission(RESOURCE, 'edit'),
  validate({ params: schemas.idParamSchema, body: schemas.policySchema }),
  controller.update
);

router.delete(
  '/:id',
  requirePermission(RESOURCE, 'delete'),
  validate({ params: schemas.idParamSchema }),
  controller.remove
);

module.exports = router;
