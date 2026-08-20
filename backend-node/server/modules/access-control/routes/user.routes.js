'use strict';

/**
 * User routes.
 *
 * Note the split between `/me/*` (self-service, needs only a valid session)
 * and the administrative routes (each guarded by an explicit permission).
 * Ordering matters: `/me` is declared before `/:id` so it is not swallowed by
 * the parameterised route.
 */

const express = require('express');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/user.controller');
const sessionController = require('../controllers/session.controller');
const schemas = require('../validators');

const router = express.Router();

router.use(authenticate);

// --- Self-service ------------------------------------------------------------
router.get('/me', controller.me);
router.patch('/me', validate({ body: schemas.updateUserSchema }), controller.updateMe);
router.post('/me/password', validate({ body: schemas.changePasswordSchema }), controller.changeMyPassword);
router.get('/me/sessions', sessionController.mine);
router.delete('/me/sessions/:id', validate({ params: schemas.idParamSchema }), sessionController.revokeMine);

// --- Administration ----------------------------------------------------------
const RESOURCE = '/security/users';

router.get(
  '/',
  requirePermission(RESOURCE, 'view'),
  validate({ query: schemas.listQuerySchema }),
  controller.list
);

router.post(
  '/',
  requirePermission(RESOURCE, 'create'),
  validate({ body: schemas.createUserSchema }),
  controller.create
);

router.get(
  '/:id',
  requirePermission(RESOURCE, 'view'),
  validate({ params: schemas.idParamSchema }),
  controller.getOne
);

router.patch(
  '/:id',
  requirePermission(RESOURCE, 'edit'),
  validate({ params: schemas.idParamSchema, body: schemas.updateUserSchema }),
  controller.update
);

router.put(
  '/:id/status',
  requirePermission(RESOURCE, 'edit'),
  validate({ params: schemas.idParamSchema, body: schemas.changeStatusSchema }),
  controller.changeStatus
);

router.delete(
  '/:id',
  requirePermission(RESOURCE, 'delete'),
  validate({ params: schemas.idParamSchema }),
  controller.remove
);

// Assigning roles is permission management, not user editing - it is guarded
// by the stricter resource so that "can edit a user's phone number" does not
// imply "can make them an administrator".
router.put(
  '/:id/roles',
  requirePermission('/security/roles', 'assign'),
  validate({ params: schemas.idParamSchema, body: schemas.assignRolesSchema }),
  controller.assignRoles
);

router.get(
  '/:id/effective-permissions',
  requirePermission(RESOURCE, 'view'),
  validate({ params: schemas.idParamSchema }),
  controller.effectivePermissions
);

router.post(
  '/:id/password/reset',
  requirePermission(RESOURCE, 'reset-password'),
  validate({ params: schemas.idParamSchema, body: schemas.resetPasswordSchema }),
  controller.resetPassword
);

router.delete(
  '/:id/sessions',
  requirePermission('/security/sessions', 'revoke'),
  validate({ params: schemas.idParamSchema }),
  sessionController.revokeForUser
);

module.exports = router;
