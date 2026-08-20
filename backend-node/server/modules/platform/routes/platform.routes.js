'use strict';

const express = require('express');

const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/bootstrap.controller');

const router = express.Router();

// Public: the login screen needs branding and the maintenance banner before
// anyone has signed in.
router.get('/info', controller.info);

router.get('/bootstrap', authenticate, controller.bootstrap);
// The module inventory lists every route, permission and setting key the
// platform declares. That is a map of the system, and a signed-in session is
// not a reason to hand one out - it is operator information, guarded like the
// rest of it.
router.get('/modules', authenticate, requirePermission('/platform/modules', 'view'), controller.modules);

module.exports = router;
