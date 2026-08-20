'use strict';

/**
 * The setting descriptor contract.
 *
 * A descriptor is the single declaration of a configurable value. From it the
 * platform derives, with no further code:
 *
 *   - validation on write            (type + constraints below)
 *   - the admin UI control           (`type` maps to a form widget)
 *   - the default when unset         (`default`)
 *   - storage handling               (`secret` triggers encryption at rest)
 *   - who may read or change it      (`permission`)
 *
 * That is the whole point of the dynamic settings engine: adding a setting is
 * one object in a module manifest, never a migration plus a form plus an
 * endpoint.
 *
 * @example
 *   {
 *     key: 'security.password.minLength',
 *     group: 'security',
 *     label: 'Minimum password length',
 *     type: 'number',
 *     default: 12,
 *     min: 8,
 *     max: 128,
 *     permission: { resource: '/settings/security', action: 'edit' }
 *   }
 */

const Joi = require('joi');

const TYPES = [
  'string',
  'text',
  'number',
  'boolean',
  'select',
  'multiselect',
  'json',
  'color',
  'date',
  'duration',
  'email',
  'url',
  'password',
  'file'
];

const SCOPES = ['global', 'organization', 'user'];

const descriptorSchema = Joi.object({
  // Dot-separated, namespaced by group. Stable across versions - it is the
  // storage key, so renaming one is a migration.
  key: Joi.string()
    .pattern(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/)
    .required()
    .messages({ 'string.pattern.base': 'key must be dot-separated camelCase, e.g. mail.smtp.host' }),

  group: Joi.string().required(),
  section: Joi.string().allow('').default(''),
  label: Joi.string().required(),
  labelKey: Joi.string().optional(),
  description: Joi.string().allow('').default(''),
  helpText: Joi.string().allow('').default(''),

  type: Joi.string().valid(...TYPES).required(),
  default: Joi.any().required(),

  // Where a value may be overridden. `global` only means one value for the
  // whole deployment; adding `user` makes it a per-user preference.
  scopes: Joi.array().items(Joi.string().valid(...SCOPES)).min(1).default(['global']),

  required: Joi.boolean().default(false),
  // Encrypted at rest and never returned in full by the read API.
  secret: Joi.boolean().default(false),
  // Read-only in the UI; changed only by a migration or an operator.
  readOnly: Joi.boolean().default(false),
  // Requires a process restart to take effect - surfaced as a UI warning.
  restartRequired: Joi.boolean().default(false),

  // Type-specific constraints.
  min: Joi.number().optional(),
  max: Joi.number().optional(),
  minLength: Joi.number().optional(),
  maxLength: Joi.number().optional(),
  pattern: Joi.string().optional(),
  options: Joi.array()
    .items(Joi.object({ value: Joi.any().required(), label: Joi.string().required() }))
    .optional(),

  // Show this setting only when another setting has a given value.
  dependsOn: Joi.object({
    key: Joi.string().required(),
    equals: Joi.any().required()
  }).optional(),

  permission: Joi.object({
    resource: Joi.string().required(),
    action: Joi.string().default('edit')
  }).required(),

  order: Joi.number().default(100)
});

/**
 * Validates a descriptor at module-load time so a malformed declaration fails
 * the boot rather than the first admin who opens the settings page.
 */
function validateDescriptor(descriptor) {
  const { value, error } = descriptorSchema.validate(descriptor, { abortEarly: false });
  if (error) {
    const details = error.details.map((d) => d.message).join('; ');
    throw new Error(`Invalid setting descriptor "${descriptor && descriptor.key}": ${details}`);
  }
  if (value.type === 'select' && !value.options) {
    throw new Error(`Setting "${value.key}" is type "select" but declares no options.`);
  }
  return value;
}

/**
 * Builds a Joi schema for a descriptor's *value*, used when a setting is
 * written through the API.
 */
function buildValueSchema(descriptor) {
  let schema;

  switch (descriptor.type) {
    case 'number':
    case 'duration':
      schema = Joi.number();
      if (descriptor.min !== undefined) schema = schema.min(descriptor.min);
      if (descriptor.max !== undefined) schema = schema.max(descriptor.max);
      break;
    case 'boolean':
      schema = Joi.boolean();
      break;
    case 'json':
      schema = Joi.alternatives().try(Joi.object(), Joi.array());
      break;
    case 'multiselect':
      schema = Joi.array().items(Joi.any().valid(...(descriptor.options || []).map((o) => o.value)));
      break;
    case 'select':
      schema = Joi.any().valid(...(descriptor.options || []).map((o) => o.value));
      break;
    case 'email':
      schema = Joi.string().email({ tlds: false });
      break;
    case 'url':
      schema = Joi.string().uri();
      break;
    case 'color':
      schema = Joi.string().pattern(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
      break;
    case 'date':
      schema = Joi.date();
      break;
    default:
      schema = Joi.string().allow('');
      if (descriptor.minLength !== undefined) schema = schema.min(descriptor.minLength);
      if (descriptor.maxLength !== undefined) schema = schema.max(descriptor.maxLength);
      if (descriptor.pattern) schema = schema.pattern(new RegExp(descriptor.pattern));
  }

  return descriptor.required ? schema.required() : schema.allow(null);
}

module.exports = { descriptorSchema, validateDescriptor, buildValueSchema, TYPES, SCOPES };
