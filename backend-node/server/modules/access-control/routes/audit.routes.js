'use strict';

const express = require('express');
const Joi = require('joi');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/audit.controller');
const schemas = require('../validators');

const router = express.Router();
const RESOURCE = '/security/audit';

router.use(authenticate);

router.get('/', requirePermission(RESOURCE, 'view'), validate({ query: schemas.auditQuerySchema }), controller.list);

router.get('/summary', requirePermission(RESOURCE, 'view'), controller.summary);

router.get(
  '/target/:type/:id',
  requirePermission(RESOURCE, 'view'),
  validate({ params: Joi.object({ type: Joi.string().required(), id: Joi.string().required() }) }),
  controller.forTarget
);

router.get('/:id', requirePermission(RESOURCE, 'view'), validate({ params: schemas.idParamSchema }), controller.getOne);

module.exports = router;
