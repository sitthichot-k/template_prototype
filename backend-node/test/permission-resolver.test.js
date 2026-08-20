'use strict';

/**
 * Authorization decision tests.
 *
 * These cover the rules that a reader of `can()` has to take on trust, and
 * that a future change could quietly break: deny beats allow, deny beats
 * super-admin, wildcards do not leak across resource boundaries, and a
 * condition that does not match yields no opinion rather than an allow.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const resolver = require('../server/core/security/permission-resolver');

// No policies unless a test says otherwise. Without this the default loader
// reaches for the Policy model, which is unregistered here - and the resolver
// correctly fails closed, which would mask what these tests are checking.
resolver.setPolicyLoader(async () => []);

function mapOf({ superAdmin = false, allow = {}, deny = {}, roles = [] } = {}) {
  return { superAdmin, allow, deny, roles, scopes: {} };
}

// --- resourceMatches ---------------------------------------------------------

test('resourceMatches: exact path', () => {
  assert.equal(resolver.resourceMatches('/security/users', '/security/users'), true);
  assert.equal(resolver.resourceMatches('/security/users', '/security/roles'), false);
});

test('resourceMatches: trailing wildcard covers descendants only', () => {
  assert.equal(resolver.resourceMatches('/security/*', '/security/users'), true);
  assert.equal(resolver.resourceMatches('/security/*', '/security/a/b'), true);
  assert.equal(resolver.resourceMatches('/security/*', '/settings/general'), false);
});

test('resourceMatches: global wildcard covers everything', () => {
  assert.equal(resolver.resourceMatches('*', '/anything/at/all'), true);
});

test('resourceMatches: a prefix that is not a path boundary does not match', () => {
  // "/security" must not grant "/securityx" - this is the classic prefix bug.
  assert.equal(resolver.resourceMatches('/security', '/securityx'), false);
});

// --- can() -------------------------------------------------------------------

test('can: grants a declared action', async () => {
  const map = mapOf({ allow: { '/security/users': ['view', 'edit'] } });
  const decision = await resolver.can({ permissionMap: map, resource: '/security/users', action: 'view' });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'GRANTED');
});

test('can: denies an action that was never granted', async () => {
  const map = mapOf({ allow: { '/security/users': ['view'] } });
  const decision = await resolver.can({ permissionMap: map, resource: '/security/users', action: 'delete' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'NOT_GRANTED');
});

test('can: an explicit deny beats an allow on the same resource', async () => {
  const map = mapOf({
    allow: { '/security/users': ['view', 'delete'] },
    deny: { '/security/users': ['delete'] }
  });

  assert.equal((await resolver.can({ permissionMap: map, resource: '/security/users', action: 'view' })).allowed, true);

  const denied = await resolver.can({ permissionMap: map, resource: '/security/users', action: 'delete' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'EXPLICIT_DENY');
});

test('can: an explicit deny beats super-admin', async () => {
  // This is the property that makes "lock this account out of X" trustworthy
  // even when the account holds the break-glass role.
  const map = mapOf({ superAdmin: true, deny: { '/security/users': ['delete'] } });

  const decision = await resolver.can({ permissionMap: map, resource: '/security/users', action: 'delete' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'EXPLICIT_DENY');
});

test('can: super-admin is allowed anything not explicitly denied', async () => {
  const map = mapOf({ superAdmin: true });
  const decision = await resolver.can({ permissionMap: map, resource: '/anything/new', action: 'delete' });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'SUPER_ADMIN');
});

test('can: an action wildcard grants every action on that resource', async () => {
  const map = mapOf({ allow: { '/settings/general': ['*'] } });
  const decision = await resolver.can({ permissionMap: map, resource: '/settings/general', action: 'edit' });
  assert.equal(decision.allowed, true);
});

test('can: a missing permission map denies', async () => {
  const decision = await resolver.can({ permissionMap: null, resource: '/x', action: 'view' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'NO_PERMISSION_MAP');
});

// --- Conditions --------------------------------------------------------------

test('matchesConditions: an empty condition set always matches', () => {
  assert.equal(resolver.matchesConditions({}, {}), true);
  assert.equal(resolver.matchesConditions(null, {}), true);
});

test('matchesConditions: comparison operators', () => {
  const context = { request: { hour: 14, ip: '10.0.0.5' }, user: { department: 'finance' } };

  assert.equal(resolver.matchesConditions({ 'request.hour': { gte: 8, lte: 18 } }, context), true);
  assert.equal(resolver.matchesConditions({ 'request.hour': { gte: 18 } }, context), false);
  assert.equal(resolver.matchesConditions({ 'user.department': { in: ['finance', 'hr'] } }, context), true);
  assert.equal(resolver.matchesConditions({ 'user.department': { nin: ['finance'] } }, context), false);
  assert.equal(resolver.matchesConditions({ 'request.ip': '10.0.0.5' }, context), true);
  assert.equal(resolver.matchesConditions({ 'request.missing': { exists: false } }, context), true);
});

test('matchesConditions: every condition must hold', () => {
  const context = { request: { hour: 14 }, user: { department: 'finance' } };
  assert.equal(
    resolver.matchesConditions({ 'request.hour': { lte: 18 }, 'user.department': { eq: 'hr' } }, context),
    false
  );
});

// --- toClientShape -----------------------------------------------------------

test('toClientShape: reports only actions the user actually holds', () => {
  const catalogue = [
    { resource: '/security/users', actions: ['view', 'create', 'edit', 'delete'] },
    { resource: '/settings/general', actions: ['view', 'edit'] }
  ];
  const map = mapOf({
    allow: { '/security/users': ['view', 'edit'], '/settings/general': ['view'] },
    deny: { '/security/users': ['edit'] }
  });

  const shape = resolver.toClientShape(map, catalogue);

  assert.deepEqual(shape['/security/users'], ['view']);
  assert.deepEqual(shape['/settings/general'], ['view']);
});

test('toClientShape: super-admin receives the whole catalogue', () => {
  const catalogue = [{ resource: '/a', actions: ['view', 'edit'] }];
  const shape = resolver.toClientShape(mapOf({ superAdmin: true }), catalogue);
  assert.deepEqual(shape['/a'], ['view', 'edit']);
});

test('toClientShape: a resource with no granted action is omitted entirely', () => {
  const catalogue = [{ resource: '/a', actions: ['view'] }];
  const shape = resolver.toClientShape(mapOf({ allow: {} }), catalogue);
  assert.equal(Object.prototype.hasOwnProperty.call(shape, '/a'), false);
});

// --- Policy layer ------------------------------------------------------------

test('can: a matching deny policy overrides a role grant', async (t) => {
  resolver.setPolicyLoader(async () => [
    {
      effect: 'deny',
      subjects: [],
      resources: ['/reports/*'],
      actions: ['export'],
      conditions: { 'request.hour': { gte: 18 } },
      priority: 100
    }
  ]);
  t.after(() => resolver.setPolicyLoader(async () => []));

  const map = mapOf({ allow: { '/reports/sales': ['view', 'export'] } });

  const afterHours = await resolver.can({
    permissionMap: map,
    resource: '/reports/sales',
    action: 'export',
    context: { request: { hour: 20 } }
  });
  assert.equal(afterHours.allowed, false);
  assert.equal(afterHours.reason, 'POLICY_DENY');

  const duringHours = await resolver.can({
    permissionMap: map,
    resource: '/reports/sales',
    action: 'export',
    context: { request: { hour: 10 } }
  });
  assert.equal(duringHours.allowed, true);
});

test('can: an allow policy grants access no role covers', async (t) => {
  resolver.setPolicyLoader(async () => [
    {
      effect: 'allow',
      subjects: ['AUDITOR'],
      resources: ['/security/audit'],
      actions: ['view'],
      conditions: {},
      priority: 100
    }
  ]);
  t.after(() => resolver.setPolicyLoader(async () => []));

  const auditor = mapOf({ allow: {}, roles: ['AUDITOR'] });
  const other = mapOf({ allow: {}, roles: ['VIEWER'] });

  assert.equal(
    (await resolver.can({ permissionMap: auditor, resource: '/security/audit', action: 'view' })).reason,
    'POLICY_ALLOW'
  );
  assert.equal(
    (await resolver.can({ permissionMap: other, resource: '/security/audit', action: 'view' })).allowed,
    false
  );
});

test('can: a supplied policy set is evaluated instead of the stored one', async (t) => {
  // What lets a write ask what it would decide before it is committed. The
  // stored loader here would allow; the supplied set must be what answers.
  resolver.setPolicyLoader(async () => []);
  t.after(() => resolver.setPolicyLoader(async () => []));

  const map = mapOf({ allow: { '/security/policies': ['edit'] } });
  const candidate = [
    {
      effect: 'deny',
      subjects: [],
      resources: ['/security/*'],
      actions: ['edit'],
      conditions: { 'request.ip': { nin: ['127.0.0.1'] } },
      priority: 100
    }
  ];

  const withCandidate = await resolver.can({
    permissionMap: map,
    resource: '/security/policies',
    action: 'edit',
    context: { request: { ip: '172.18.0.1' } },
    policies: candidate
  });
  assert.equal(withCandidate.allowed, false);
  assert.equal(withCandidate.reason, 'POLICY_DENY');

  // Nothing was written, so the stored path is unaffected.
  const stored = await resolver.can({
    permissionMap: map,
    resource: '/security/policies',
    action: 'edit',
    context: { request: { ip: '172.18.0.1' } }
  });
  assert.equal(stored.allowed, true);
});

test('can: a failing policy store denies rather than falling open', async (t) => {
  resolver.setPolicyLoader(async () => {
    throw new Error('policy store unreachable');
  });
  t.after(() => resolver.setPolicyLoader(async () => []));

  const map = mapOf({ allow: { '/security/users': ['view'] } });
  const decision = await resolver.can({ permissionMap: map, resource: '/security/users', action: 'view' });

  assert.equal(decision.allowed, false, 'an unavailable policy store must not widen access');
  assert.equal(decision.reason, 'POLICY_DENY');
});
