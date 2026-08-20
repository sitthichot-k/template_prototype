'use strict';

/**
 * Starter access policies.
 *
 * Every entry expresses something the Permission Matrix **cannot**: a rule
 * that depends on when or from where a request arrives. Anything that holds
 * unconditionally belongs on a role instead, which is why the validator now
 * refuses a policy with no conditions.
 *
 * ---------------------------------------------------------------------------
 * They are seeded INACTIVE, and that is not timidity.
 * ---------------------------------------------------------------------------
 * Each one carries a placeholder allowlist or date window that is wrong for
 * every real deployment. Activating "security administration from trusted
 * networks" while the allowlist still reads `127.0.0.1` locks every
 * administrator out of the security screens the moment it is switched on -
 * behind Docker, requests arrive from the bridge network (`172.x`), not from
 * loopback. A seeded policy that is active and wrong is worse than no policy,
 * because the lockout arrives later and looks like a bug.
 *
 * So the intended flow is: seed → edit the placeholder → simulate → activate.
 * The simulator on the policy screen exists for exactly this step.
 *
 * Conditions may only reference fields that `core/security/authorize.js`
 * actually puts in the context: `user.id`, `user.roles`, `request.ip`,
 * `request.method`, `request.path`, `request.at`. Each definition is validated
 * against the same Joi schema the API uses before it is inserted, so a starter
 * can never be something an administrator would be unable to edit and re-save.
 */

/** Obvious placeholders. They are meant to fail a review, not to be plausible. */
const PLACEHOLDER_ALLOWLIST = ['127.0.0.1', '::1'];

const DEFAULT_POLICIES = [
  {
    name: 'Security administration from trusted networks only',
    description:
      'Denies changes to users, roles, permissions and policies unless the request comes from an allowlisted address. ' +
      'Replace the placeholder addresses with your office or VPN egress IPs before activating.',
    effect: 'deny',
    subjects: [],
    resources: ['/security/*'],
    actions: ['create', 'edit', 'delete'],
    // `nin` = deny when the address is NOT one of these. Exact matches only:
    // the operator set has no CIDR support, so ranges must be enumerated.
    conditions: { 'request.ip': { nin: PLACEHOLDER_ALLOWLIST } },
    priority: 900,
    isActive: false
  },
  {
    name: 'Change freeze window',
    description:
      'Denies all create, edit and delete operations during a maintenance or year-end freeze. ' +
      'Set the window to your own dates before activating; the placeholder window is in the past.',
    effect: 'deny',
    subjects: [],
    resources: ['*'],
    actions: ['create', 'edit', 'delete'],
    // ISO-8601 UTC strings sort chronologically as text, and `request.at` is
    // always produced by toISOString(), so gte/lte give a real date window.
    conditions: {
      'request.at': { gte: '2020-01-01T00:00:00.000Z', lte: '2020-01-02T00:00:00.000Z' }
    },
    priority: 950,
    isActive: false
  },
  {
    name: 'Break-glass account pinned to a trusted network',
    description:
      'Denies super-administrators everything unless they connect from an allowlisted address. ' +
      'This is the one rule roles cannot express: a policy deny outranks the super-admin bypass. ' +
      'Replace the placeholder addresses before activating.',
    effect: 'deny',
    subjects: ['SUPER_ADMIN'],
    resources: ['*'],
    actions: ['*'],
    conditions: { 'request.ip': { nin: PLACEHOLDER_ALLOWLIST } },
    // Highest priority: evaluated before any other rule.
    priority: 1000,
    isActive: false
  }
];

module.exports = { DEFAULT_POLICIES, PLACEHOLDER_ALLOWLIST };
