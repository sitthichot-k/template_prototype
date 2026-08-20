'use strict';

/**
 * Settings endpoints.
 *
 * There is no per-setting endpoint and no per-setting form. The schema
 * endpoint returns descriptors, the frontend renders controls from them, and
 * the write endpoint validates against the same descriptors. Adding a setting
 * anywhere in the system therefore requires no change to this file.
 */

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const AppError = require('../../../core/errors/AppError');
const settingsService = require('../../../core/settings/settings-service');
const mailService = require('../../../core/mail/mail-service');
const permissionResolver = require('../../../core/security/permission-resolver');
const { loadPermissionMap } = require('../../../core/security/authenticate');
const auditService = require('../../../core/audit/audit-service');

/**
 * Descriptors plus current values, grouped for the UI.
 *
 * Each group is filtered against the caller's permissions, so a user who may
 * only see mail settings receives only that group rather than a full schema
 * with most of it disabled.
 */
const schema = asyncHandler(async (req, res) => {
  const permissionMap = await loadPermissionMap(req);
  const groups = await settingsService.describeForUi({ userId: req.auth.userId });

  const visible = [];
  for (const group of groups) {
    const sections = [];
    for (const section of group.sections) {
      const items = [];
      for (const item of section.items) {
        const viewDecision = await permissionResolver.can({
          permissionMap,
          resource: item.permission.resource,
          action: 'view'
        });
        if (!viewDecision.allowed) continue;

        const editDecision = await permissionResolver.can({
          permissionMap,
          resource: item.permission.resource,
          action: item.permission.action
        });

        items.push(Object.assign({}, item, { editable: editDecision.allowed && !item.readOnly }));
      }
      if (items.length) sections.push({ section: section.section, items });
    }
    if (sections.length) visible.push({ group: group.group, sections });
  }

  return response.ok(res, { groups: visible });
});

/**
 * Resolved values, filtered to what the caller may see.
 *
 * `getAll` withholds secrets, but "not a credential" is not the same as
 * "everyone's business": SMTP hosts and usernames, retention windows and
 * lockout thresholds describe how the deployment is defended. This endpoint
 * used to return the lot to anyone with a session, while `/schema` next to it
 * filtered every item against the caller's `view` permission. The two now
 * answer the same question the same way.
 */
const values = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  const permissionMap = await loadPermissionMap(req);
  const resolved = await settingsService.getAll({ userId: req.auth.userId });

  const visible = {};
  for (const [key, value] of Object.entries(resolved)) {
    const descriptor = registry.getSetting(key);
    if (!descriptor) continue;

    const decision = await permissionResolver.can({
      permissionMap,
      resource: descriptor.permission.resource,
      action: 'view'
    });
    if (decision.allowed) visible[key] = value;
  }

  return response.ok(res, visible);
});

/**
 * Writes one or more settings.
 *
 * Batched because settings screens save a whole section at once. Each key is
 * permission-checked individually - a single request may legitimately span
 * two groups the caller has different rights over.
 */
const update = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  const permissionMap = await loadPermissionMap(req);
  const scope = req.body.scope || 'global';
  const scopeId = req.body.scopeId || null;

  const results = [];
  const rejected = [];

  for (const [key, value] of Object.entries(req.body.values || {})) {
    const descriptor = registry.getSetting(key);
    if (!descriptor) {
      rejected.push({ key, reason: 'UNKNOWN_SETTING' });
      continue;
    }

    const decision = await permissionResolver.can({
      permissionMap,
      resource: descriptor.permission.resource,
      action: descriptor.permission.action
    });
    if (!decision.allowed) {
      rejected.push({ key, reason: 'FORBIDDEN' });
      continue;
    }

    // A per-user scope may only ever target the caller's own record.
    if (scope === 'user' && String(scopeId || req.auth.userId) !== req.auth.userId) {
      rejected.push({ key, reason: 'FORBIDDEN_SCOPE' });
      continue;
    }

    const result = await settingsService.set(key, value, {
      scope,
      scopeId: scope === 'user' ? req.auth.userId : scopeId,
      actorId: req.auth.userId
    });
    results.push(result);
  }

  // A pooled SMTP connection outlives the settings it was opened with, so an
  // edited host or password would otherwise take effect only after a restart.
  if (results.some((result) => result.key.startsWith('notification.mail.'))) {
    mailService.reset();
  }

  if (results.length) {
    await auditService.record({
      action: 'settings.updated',
      category: 'configuration',
      actorId: req.auth.userId,
      metadata: {
        scope,
        keys: results.map((r) => r.key),
        // Secret values are reported as changed without their content.
        changes: results.map((r) => ({ key: r.key, from: r.previous, to: r.value }))
      },
      req
    });
  }

  if (!results.length && rejected.length) {
    throw AppError.forbidden('None of the submitted settings could be updated.', { rejected });
  }

  return response.ok(res, {
    updated: results,
    rejected,
    restartRequired: results.some((r) => r.restartRequired)
  });
});

/** Removes an override, restoring the value from the scope below. */
const reset = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  const descriptor = registry.getSetting(req.params.key);
  if (!descriptor) throw AppError.notFound('Setting');

  const permissionMap = await loadPermissionMap(req);
  const decision = await permissionResolver.can({
    permissionMap,
    resource: descriptor.permission.resource,
    action: descriptor.permission.action
  });
  if (!decision.allowed) throw AppError.forbidden();

  const result = await settingsService.reset(req.params.key, {
    scope: req.query.scope || 'global',
    scopeId: req.query.scopeId || null
  });

  await auditService.record({
    action: 'settings.reset',
    category: 'configuration',
    actorId: req.auth.userId,
    metadata: { key: req.params.key },
    req
  });

  return response.ok(res, result);
});

/**
 * Opens an SMTP connection and authenticates, without sending anything.
 *
 * Mail configuration is the kind that is wrong silently: the settings save,
 * the screen says nothing, and the first anyone knows is a security
 * notification that never arrived. Guarded by the same permission that edits
 * the notification settings - being able to make the platform connect
 * outwards is exactly the right to configure where it connects.
 */
const testMail = asyncHandler(async (req, res) => {
  const registry = req.app.get('moduleRegistry');
  const descriptor = registry.getSetting('notification.mail.enabled');
  const permissionMap = await loadPermissionMap(req);

  const decision = await permissionResolver.can({
    permissionMap,
    resource: descriptor.permission.resource,
    action: descriptor.permission.action
  });
  if (!decision.allowed) throw AppError.forbidden();

  const result = await mailService.verify();

  await auditService.record({
    action: 'settings.mail.tested',
    category: 'configuration',
    outcome: result.ok ? 'success' : 'failure',
    actorId: req.auth.userId,
    metadata: { reason: result.reason },
    req
  });

  return response.ok(res, result);
});

module.exports = { schema, values, update, reset, testMail };
