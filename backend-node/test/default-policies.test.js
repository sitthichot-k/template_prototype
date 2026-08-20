'use strict';

/**
 * Tests for the starter policy set and the rule that makes it coherent.
 *
 * Two things are being protected here.
 *
 * First, the validator now refuses a policy with no conditions. Without that
 * rule a policy can express something a role grant already expresses, but
 * through a path with different precedence and no representation in the
 * Permission Matrix - an allow nobody can see in the UI, or a deny that
 * outranks super-admin.
 *
 * Second, a starter policy must actually be able to fire. Both examples
 * previously documented on the model could not: `request.hour` is not a field
 * the authorization context contains, and `in` compares array membership
 * rather than CIDR ranges, so an address rule written as a subnet never
 * matches anything. A rule that silently never matches is worse than a missing
 * one, because a deny that does nothing looks like protection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const resolver = require('../server/core/security/permission-resolver');
const schemas = require('../server/modules/access-control/validators');
const { DEFAULT_POLICIES, PLACEHOLDER_ALLOWLIST } = require('../server/modules/access-control/seeds/default-policies');

resolver.setPolicyLoader(async () => []);

/** The fields `core/security/authorize.js` actually puts in the context. */
const CONTEXT_FIELDS = ['user.id', 'user.roles', 'request.ip', 'request.method', 'request.path', 'request.at'];

// --- the validator rule ------------------------------------------------------

test('a policy with no conditions is rejected, however it is expressed', () => {
  const base = {
    name: 'Unconditional allow',
    effect: 'allow',
    resources: ['/security/users'],
    actions: ['view']
  };

  // Omitting the field and sending an empty object are the same mistake, and
  // must produce the same explanation rather than Joi's generic wording.
  for (const conditions of [undefined, {}]) {
    const payload = conditions === undefined ? base : Object.assign({}, base, { conditions });
    const { error } = schemas.policySchema.validate(payload);

    assert.ok(error, `a condition-less policy must not be accepted (conditions: ${JSON.stringify(conditions)})`);
    assert.match(error.message, /belongs on a role/);
  }
});

test('a policy with a condition is accepted', () => {
  const { error } = schemas.policySchema.validate({
    name: 'Conditional deny',
    effect: 'deny',
    resources: ['/security/users'],
    actions: ['delete'],
    conditions: { 'request.ip': { nin: ['203.0.113.1'] } }
  });

  assert.equal(error, undefined);
});

// --- the starter set ---------------------------------------------------------

test('every starter policy satisfies the API schema', () => {
  for (const policy of DEFAULT_POLICIES) {
    const { error } = schemas.policySchema.validate(policy);
    assert.equal(error, undefined, `"${policy.name}" would be rejected by POST /policies: ${error && error.message}`);
  }
});

test('every starter policy is inactive', () => {
  for (const policy of DEFAULT_POLICIES) {
    assert.equal(
      policy.isActive,
      false,
      `"${policy.name}" ships active, and its placeholder allowlist would lock administrators out on first boot`
    );
  }
});

test('starter policy names are unique, since seeding is idempotent by name', () => {
  const names = DEFAULT_POLICIES.map((policy) => policy.name);
  assert.equal(new Set(names).size, names.length);
});

test('starter conditions only reference fields the authorization context provides', () => {
  for (const policy of DEFAULT_POLICIES) {
    for (const field of Object.keys(policy.conditions)) {
      assert.ok(
        CONTEXT_FIELDS.includes(field),
        `"${policy.name}" conditions on "${field}", which is never present in the context, so it can never match`
      );
    }
  }
});

test('starter policies are editable: none is marked isSystem', () => {
  for (const policy of DEFAULT_POLICIES) {
    assert.notEqual(policy.isSystem, true, `"${policy.name}" could not be edited or deleted by an administrator`);
  }
});

// --- they actually fire ------------------------------------------------------

test('the trusted-network starter denies an address outside the allowlist', async () => {
  const policy = DEFAULT_POLICIES.find((p) => p.resources.includes('/security/*'));
  resolver.setPolicyLoader(async () => [Object.assign({}, policy, { isActive: true })]);

  const permissionMap = { superAdmin: false, allow: { '/security/users': ['edit'] }, deny: {}, roles: [], scopes: {} };

  const denied = await resolver.can({
    permissionMap,
    resource: '/security/users',
    action: 'edit',
    context: { request: { ip: '198.51.100.7' } }
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'POLICY_DENY');

  const allowed = await resolver.can({
    permissionMap,
    resource: '/security/users',
    action: 'edit',
    context: { request: { ip: PLACEHOLDER_ALLOWLIST[0] } }
  });
  assert.equal(allowed.allowed, true, 'an allowlisted address must still get through');

  resolver.setPolicyLoader(async () => []);
});

test('the break-glass starter outranks super-admin, which no role grant can', async () => {
  const policy = DEFAULT_POLICIES.find((p) => p.subjects.includes('SUPER_ADMIN'));
  resolver.setPolicyLoader(async () => [Object.assign({}, policy, { isActive: true })]);

  const decision = await resolver.can({
    permissionMap: { superAdmin: true, allow: {}, deny: {}, roles: ['SUPER_ADMIN'], scopes: {} },
    resource: '/security/users',
    action: 'delete',
    context: { request: { ip: '198.51.100.7' } }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'POLICY_DENY');

  resolver.setPolicyLoader(async () => []);
});

/**
 * The lockout the activation guard exists to refuse.
 *
 * Behind Docker a request arrives from the bridge network, never from
 * loopback, so the placeholder allowlist matches nothing an administrator
 * actually connects from. Activating this starter unedited therefore denies
 * the super-admin `edit` on `/security/policies` - the permission needed to
 * switch it back off. `POST/PATCH /policies` runs exactly this check against
 * the pending rule and refuses the write; without it the only way back is a
 * shell on the database.
 */
test('the break-glass starter, activated unedited, would deny its author the way back', async () => {
  const policy = DEFAULT_POLICIES.find((p) => p.subjects.includes('SUPER_ADMIN'));
  const pending = [Object.assign({}, policy, { isActive: true })];

  const decision = await resolver.can({
    permissionMap: { superAdmin: true, allow: {}, deny: {}, roles: ['SUPER_ADMIN'], scopes: {} },
    resource: '/security/policies',
    action: 'edit',
    context: { request: { ip: '172.18.0.1' } },
    policies: pending
  });

  assert.equal(decision.allowed, false, 'the guard has nothing to catch if this rule does not deny');
  assert.equal(decision.reason, 'POLICY_DENY');
});

test('the change-freeze starter denies inside its window and not outside it', async () => {
  const policy = DEFAULT_POLICIES.find((p) => p.conditions['request.at']);
  resolver.setPolicyLoader(async () => [Object.assign({}, policy, { isActive: true })]);

  const permissionMap = { superAdmin: false, allow: { '/security/users': ['create'] }, deny: {}, roles: [], scopes: {} };
  const inside = policy.conditions['request.at'].gte;

  const duringFreeze = await resolver.can({
    permissionMap,
    resource: '/security/users',
    action: 'create',
    context: { request: { at: inside } }
  });
  assert.equal(duringFreeze.allowed, false, 'a create inside the freeze window must be denied');

  const afterFreeze = await resolver.can({
    permissionMap,
    resource: '/security/users',
    action: 'create',
    context: { request: { at: '2099-01-01T00:00:00.000Z' } }
  });
  assert.equal(afterFreeze.allowed, true, 'outside the window the policy must have no opinion');

  resolver.setPolicyLoader(async () => []);
});
