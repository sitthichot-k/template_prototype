'use strict';

/**
 * ABAC policy administration.
 *
 * Every write invalidates the policy cache immediately - a policy that takes
 * five minutes to apply is not a security control.
 */

const mongoose = require('mongoose');

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const AppError = require('../../../core/errors/AppError');
const BaseRepository = require('../../../core/db/base-repository');
const permissionResolver = require('../../../core/security/permission-resolver');
const auditService = require('../../../core/audit/audit-service');
const schemas = require('../validators');
const { DEFAULT_POLICIES } = require('../seeds/default-policies');

const RESOURCE = '/security/policies';

let repository = null;
function repo() {
  if (!repository) {
    repository = new BaseRepository(mongoose.model('Policy'), {
      sortable: ['createdAt', 'updatedAt', 'name', 'priority'],
      filterable: ['effect', 'isActive'],
      searchable: ['name', 'description']
    });
  }
  return repository;
}

/**
 * Refuses a write that would leave its own author unable to undo it.
 *
 * A policy deny outranks the super-admin bypass - that is the point of the
 * layer, and the starter set ships a rule that relies on it. The consequence
 * is that one careless activation can deny `*` on `*` to everybody, including
 * whoever is holding the mouse, and the screen that would switch it back off
 * is behind the very permission it just revoked. Recovery then means a shell
 * on the database. Seeding the starters inactive delays that moment; it does
 * not prevent it.
 *
 * So before a policy takes effect, it is asked the only question that matters:
 * with this rule live, can the author still edit policies from where they are
 * sitting? If not, the write is refused and nothing changes.
 *
 * This catches the immediate lockout, which is the one that actually happens.
 * It cannot catch every one: conditions are contextual, so a deny keyed to a
 * date next month passes this check today and bites later. That case is what
 * `npm run policy:recover` is for.
 */
async function assertActorKeepsControl(req, candidate, { replacesId = null } = {}) {
  // An inactive rule decides nothing, and a deactivation only ever removes a
  // deny - neither can lock anyone out.
  if (!candidate.isActive) return;

  const Policy = mongoose.model('Policy');
  const User = mongoose.model('User');

  const others = await Policy.find({
    isActive: true,
    deletedAt: null,
    ...(replacesId ? { _id: { $ne: replacesId } } : {})
  }).lean();

  // Same ordering the stored loader applies, so the guard evaluates the rules
  // in the order the live request would meet them.
  const projected = [...others, candidate].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const actor = await User.findOne({ _id: req.auth.userId, deletedAt: null })
    .select('permissionVersion')
    .lean();

  const permissionMap = await permissionResolver.getPermissionMap(
    req.auth.userId,
    (actor && actor.permissionVersion) || 0
  );

  // The context is built exactly as `requirePermission` builds it. A guard
  // that evaluated a differently-shaped context would be answering about a
  // request that never happens.
  const decision = await permissionResolver.can({
    permissionMap,
    resource: RESOURCE,
    action: 'edit',
    context: {
      user: { id: req.auth.userId, roles: req.auth.roles },
      request: { ip: req.ip, method: req.method, path: req.path, at: new Date().toISOString() }
    },
    policies: projected
  });

  if (decision.allowed) return;

  // Unlike an authorization denial, this message names what it matched on.
  // The caller already holds policy administration - withholding the reason
  // here teaches them nothing and leaves them guessing at a rule they wrote.
  throw AppError.conflict(
    `This policy would deny you access to policy administration, leaving no way to switch it off again. ` +
      `Your request address is ${req.ip}. Adjust the rule - or its conditions - so it still permits ` +
      `'edit' on ${RESOURCE} for you, then activate it.`,
    { reason: decision.reason, actorIp: req.ip, resource: RESOURCE, action: 'edit' }
  );
}

const list = asyncHandler(async (req, res) => {
  const result = await repo().list(req.query);
  return response.paginated(res, result.items, result);
});

const getOne = asyncHandler(async (req, res) => {
  return response.ok(res, await repo().findByIdOrFail(req.params.id));
});

const create = asyncHandler(async (req, res) => {
  await assertActorKeepsControl(req, req.body);

  const policy = await repo().create(req.body, { actorId: req.auth.userId });
  await permissionResolver.invalidatePolicies();

  await auditService.record({
    action: 'policy.created',
    category: 'security',
    actorId: req.auth.userId,
    target: { type: 'policy', id: String(policy._id), label: policy.name },
    metadata: { effect: policy.effect, resources: policy.resources },
    req
  });

  return response.created(res, policy);
});

const update = asyncHandler(async (req, res) => {
  const existing = await repo().findByIdOrFail(req.params.id);
  if (existing.isSystem) throw AppError.forbidden('A system policy cannot be modified.');

  await assertActorKeepsControl(req, req.body, { replacesId: req.params.id });

  const before = existing.toJSON();
  const policy = await repo().updateById(req.params.id, req.body, { actorId: req.auth.userId });
  await permissionResolver.invalidatePolicies();

  await auditService.recordChange({
    action: 'policy.updated',
    category: 'security',
    target: { type: 'policy', id: String(policy._id), label: policy.name },
    before,
    after: policy.toJSON(),
    req
  });

  return response.ok(res, policy);
});

const remove = asyncHandler(async (req, res) => {
  const existing = await repo().findByIdOrFail(req.params.id);
  if (existing.isSystem) throw AppError.forbidden('A system policy cannot be deleted.');

  await repo().deleteById(req.params.id, { actorId: req.auth.userId });
  await permissionResolver.invalidatePolicies();

  await auditService.record({
    action: 'policy.deleted',
    category: 'security',
    actorId: req.auth.userId,
    target: { type: 'policy', id: req.params.id, label: existing.name },
    req
  });

  return response.noContent(res);
});

/**
 * Dry-run: would this policy set allow a given request? Lets an administrator
 * check the effect of a rule before enabling it.
 */
const simulate = asyncHandler(async (req, res) => {
  const { userId, resource, action, context } = req.body;
  const User = mongoose.model('User');
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('permissionVersion').lean();
  if (!user) throw AppError.notFound('User');

  const permissionMap = await permissionResolver.getPermissionMap(userId, user.permissionVersion || 0);
  const decision = await permissionResolver.can({ permissionMap, resource, action, context: context || {} });

  return response.ok(res, { userId, resource, action, ...decision });
});

/**
 * Installs the starter policy set.
 *
 * Idempotent by name, so running it twice is safe and a project that already
 * edited one of the starters does not get it reset - the second run reports it
 * as skipped rather than overwriting a rule somebody tuned.
 *
 * Every definition is validated against the same schema the API enforces
 * before it is written. A starter that could not be created through
 * `POST /policies` would be a starter nobody could edit and save again.
 */
const seedDefaults = asyncHandler(async (req, res) => {
  const Policy = mongoose.model('Policy');

  const created = [];
  const skipped = [];

  for (const definition of DEFAULT_POLICIES) {
    const existing = await Policy.findOne({ name: definition.name, deletedAt: null }).lean();
    if (existing) {
      skipped.push(definition.name);
      continue;
    }

    const { error, value } = schemas.policySchema.validate(definition);
    if (error) {
      throw AppError.internal(
        `Default policy "${definition.name}" does not satisfy the policy schema: ${error.message}`
      );
    }

    const policy = await repo().create(value, { actorId: req.auth.userId });
    created.push(policy.name);
  }

  // Only a write can change a decision, so only a write needs the cache dropped.
  if (created.length) await permissionResolver.invalidatePolicies();

  await auditService.record({
    action: 'policy.defaults_seeded',
    category: 'security',
    actorId: req.auth.userId,
    target: { type: 'policy', id: 'defaults', label: 'Starter policy set' },
    metadata: { created, skipped },
    req
  });

  return response.ok(res, {
    created,
    skipped,
    // Stated in the response so a caller who never reads the screen still
    // learns the rules are inert until edited and switched on.
    note:
      'Starter policies are created inactive and carry placeholder addresses and dates. ' +
      'Edit each one, check it with the simulator, then activate it.'
  });
});

module.exports = { list, getOne, create, update, remove, simulate, seedDefaults };
