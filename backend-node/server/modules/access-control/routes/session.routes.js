'use strict';

/**
 * Administrative session routes.
 *
 * Self-service session management lives under `/users/me/sessions` - this
 * router is the cross-user view used during an investigation.
 */

const express = require('express');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/session.controller');
const schemas = require('../validators');

const router = express.Router();
const RESOURCE = '/security/sessions';

router.use(authenticate);

router.get('/', requirePermission(RESOURCE, 'view'), validate({ query: schemas.listQuerySchema }), controller.list);

module.exports = router;
