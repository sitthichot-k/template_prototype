'use strict';

const express = require('express');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/role.controller');
const schemas = require('../validators');

const router = express.Router();
const RESOURCE = '/security/roles';

router.use(authenticate);

router.get('/', requirePermission(RESOURCE, 'view'), validate({ query: schemas.listQuerySchema }), controller.list);

router.post('/', requirePermission(RESOURCE, 'create'), validate({ body: schemas.createRoleSchema }), controller.create);

router.get(
  '/:id',
  requirePermission(RESOURCE, 'view'),
  validate({ params: schemas.idParamSchema }),
  controller.getOne
);

router.patch(
  '/:id',
  requirePermission(RESOURCE, 'edit'),
  validate({ params: schemas.idParamSchema, body: schemas.updateRoleSchema }),
  controller.update
);

router.delete(
  '/:id',
  requirePermission(RESOURCE, 'delete'),
  validate({ params: schemas.idParamSchema }),
  controller.remove
);

router.get(
  '/:id/members',
  requirePermission(RESOURCE, 'view'),
  validate({ params: schemas.idParamSchema, query: schemas.listQuerySchema }),
  controller.members
);

module.exports = router;
