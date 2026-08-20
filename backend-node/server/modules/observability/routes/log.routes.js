'use strict';

const express = require('express');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/log.controller');
const schemas = require('../validators');

const router = express.Router();
const RESOURCE = '/observability/logs';

router.use(authenticate);

// Declared before `/:id` or the literal paths would be read as ids.
router.get(
  '/summary',
  requirePermission(RESOURCE, 'view'),
  validate({ query: schemas.windowQuerySchema }),
  controller.summary
);

router.get(
  '/stats',
  requirePermission(RESOURCE, 'view'),
  validate({ query: schemas.windowQuerySchema }),
  controller.stats
);

router.get('/', requirePermission(RESOURCE, 'view'), validate({ query: schemas.logQuerySchema }), controller.list);

router.get(
  '/:id',
  requirePermission(RESOURCE, 'view'),
  validate({ params: schemas.idParamSchema }),
  controller.getOne
);

module.exports = router;
