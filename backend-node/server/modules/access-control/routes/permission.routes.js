'use strict';

const express = require('express');

const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/permission.controller');

const router = express.Router();

router.use(authenticate);

// Reading your own permissions needs no permission - a user must be able to
// discover what they may do in order for the UI to render at all.
router.get('/mine', controller.mine);

router.get('/catalogue', requirePermission('/security/permissions', 'view'), controller.catalogue);

module.exports = router;
