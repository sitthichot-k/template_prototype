'use strict';

/**
 * Request schemas for the access-control module.
 *
 * Kept in one file per module so the entire input surface of the module can
 * be reviewed at once - which is the practical way to answer "what can a
 * caller actually send us here".
 */

const Joi = require('joi');
const { listQuerySchema } = require('../../../core/http/pagination');

const objectId = Joi.string().hex().length(24);

const grantArray = Joi.array().items(
  Joi.object({
    resource: Joi.string().pattern(/^\/[a-z0-9\-/*]*$/).required(),
    actions: Joi.array().items(Joi.string()).min(1).required()
  })
);

const password = Joi.string().min(12).max(128);

// --- Auth --------------------------------------------------------------------

const loginSchema = Joi.object({
  provider: Joi.string().default('local'),
  identifier: Joi.string().trim().max(200).when('provider', {
    is: 'local',
    then: Joi.required()
  }),
  password: Joi.string().max(200).when('provider', {
    is: 'local',
    then: Joi.required()
  }),
  // OIDC callback fields
  code: Joi.string().max(2000).optional(),
  state: Joi.string().max(500).optional()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().max(500).optional()
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: password.required(),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
    'any.only': 'Passwords do not match.'
  })
});

// --- Users -------------------------------------------------------------------

const profileSchema = Joi.object({
  avatarUrl: Joi.string().uri().allow('').optional(),
  phone: Joi.string().allow('').max(30).optional(),
  locale: Joi.string().max(10).optional(),
  timezone: Joi.string().max(60).optional(),
  department: Joi.string().allow('').max(120).optional(),
  position: Joi.string().allow('').max(120).optional()
});

const createUserSchema = Joi.object({
  email: Joi.string().email({ tlds: false }).required(),
  username: Joi.string().alphanum().min(3).max(40).optional(),
  displayName: Joi.string().trim().min(1).max(150).required(),
  password: password.optional(),
  mustChangePassword: Joi.boolean().default(true),
  roleIds: Joi.array().items(objectId).default([]),
  profile: profileSchema.default({}),
  attributes: Joi.object().default({})
});

const updateUserSchema = Joi.object({
  displayName: Joi.string().trim().min(1).max(150).optional(),
  username: Joi.string().alphanum().min(3).max(40).allow(null).optional(),
  profile: profileSchema.optional(),
  attributes: Joi.object().optional()
}).min(1);

const changeStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'active', 'suspended', 'disabled').required(),
  reason: Joi.string().allow('').max(500).default('')
});

const assignRolesSchema = Joi.object({
  roleIds: Joi.array().items(objectId).required(),
  scope: Joi.string().default('global'),
  scopeId: objectId.allow(null).default(null)
});

const resetPasswordSchema = Joi.object({
  newPassword: password.required()
});

// --- Roles -------------------------------------------------------------------

const createRoleSchema = Joi.object({
  code: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9_]{1,40}$/).required(),
  name: Joi.string().trim().min(1).max(150).required(),
  description: Joi.string().allow('').max(500).default(''),
  isSuperAdmin: Joi.boolean().default(false),
  isActive: Joi.boolean().default(true),
  grants: grantArray.default([]),
  allowedScopes: Joi.array().items(Joi.string()).default(['global']),
  priority: Joi.number().integer().min(0).max(1000).default(100)
});

const updateRoleSchema = Joi.object({
  code: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9_]{1,40}$/).optional(),
  name: Joi.string().trim().min(1).max(150).optional(),
  description: Joi.string().allow('').max(500).optional(),
  isSuperAdmin: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  grants: grantArray.optional(),
  allowedScopes: Joi.array().items(Joi.string()).optional(),
  priority: Joi.number().integer().min(0).max(1000).optional()
}).min(1);

// --- Policies ----------------------------------------------------------------

const policySchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  description: Joi.string().allow('').max(500).default(''),
  effect: Joi.string().valid('allow', 'deny').required(),
  subjects: Joi.array().items(Joi.string()).default([]),
  resources: Joi.array().items(Joi.string()).min(1).required(),
  actions: Joi.array().items(Joi.string()).min(1).required(),
  /**
   * At least one condition is required.
   *
   * `matchesConditions` treats an empty condition map as "always matches", so
   * a policy without conditions is an unconditional allow or deny - which is
   * exactly what a role grant already expresses, but reached through a
   * different code path with different precedence. The damage is to
   * auditability: an unconditional policy allow grants access that never
   * appears in the Permission Matrix, and `toClientShape` does not evaluate
   * policies, so the UI would hide a control the API then permits.
   *
   * If a rule needs no condition, it belongs on a role.
   */
  conditions: Joi.object()
    .min(1)
    .required()
    .messages({
      // Both failure modes get the same guidance: omitting the field and
      // sending `{}` are the same mistake, and the fix is the same.
      'object.min':
        'A policy needs at least one condition. An unconditional rule belongs on a role, not a policy.',
      'any.required':
        'A policy needs at least one condition. An unconditional rule belongs on a role, not a policy.'
    }),
  priority: Joi.number().integer().min(0).max(1000).default(100),
  isActive: Joi.boolean().default(true)
});

// --- Shared ------------------------------------------------------------------

const idParamSchema = Joi.object({ id: objectId.required() });

const auditQuerySchema = listQuerySchema.keys({
  category: Joi.string().valid('auth', 'security', 'data', 'configuration', 'system').optional(),
  outcome: Joi.string().valid('success', 'failure', 'denied').optional(),
  actorId: objectId.optional(),
  action: Joi.string().max(100).optional(),
  from: Joi.date().optional(),
  to: Joi.date().optional()
});

module.exports = {
  objectId,
  idParamSchema,
  listQuerySchema,
  auditQuerySchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  changeStatusSchema,
  assignRolesSchema,
  resetPasswordSchema,
  createRoleSchema,
  updateRoleSchema,
  policySchema
};
