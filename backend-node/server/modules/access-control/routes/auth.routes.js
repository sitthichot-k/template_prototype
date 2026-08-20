'use strict';

/**
 * Auth routes.
 *
 * The only routes in the platform that are reachable without a token. Each is
 * rate-limited on IP plus submitted identifier.
 */

const express = require('express');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { authRateLimiter } = require('../../../../middleware/rate-limit');
const controller = require('../controllers/auth.controller');
const schemas = require('../validators');

const router = express.Router();

// --- Public ------------------------------------------------------------------
router.get('/providers', controller.listProviders);
router.get('/sso/start', authRateLimiter, controller.startSso);
router.post('/login', authRateLimiter, validate({ body: schemas.loginSchema }), controller.login);
// Rate-limited like login: it presents a credential, and an unlimited stream
// of rejected refreshes is a database round-trip each. The limiter keys on the
// address here, since a refresh carries no identifier - and `skipSuccessful`
// means a client renewing normally never touches the budget.
router.post('/refresh', authRateLimiter, validate({ body: schemas.refreshSchema }), controller.refresh);

// --- Authenticated -----------------------------------------------------------
router.post('/logout', authenticate, controller.logout);
router.post('/logout-all', authenticate, controller.logoutAll);

module.exports = router;
