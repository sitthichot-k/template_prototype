/* eslint-disable no-undef */
/**
 * Baseline indexes for the phase-1 access-control and settings collections.
 *
 * Mongoose also declares these in the schemas; creating them here means a
 * freshly provisioned database is correct even before the API has booted.
 * Both paths are idempotent.
 */
(function createBaselineIndexes() {
  const dbName = process.env.MONGO_INITDB_DATABASE || 'app';
  const appDb = db.getSiblingDB(dbName);

  appDb.users.createIndex({ email: 1 }, { unique: true, name: 'uniq_email' });
  // Partial, not sparse: `username` defaults to null and sparse only skips
  // documents where the key is absent, so every account without a username
  // would collide.
  appDb.users.createIndex(
    { username: 1 },
    { unique: true, name: 'uniq_username', partialFilterExpression: { username: { $type: 'string' } } }
  );
  appDb.users.createIndex({ status: 1, deletedAt: 1 }, { name: 'by_status' });
  appDb.users.createIndex({ 'identities.provider': 1, 'identities.subject': 1 }, { name: 'by_external_identity' });

  appDb.roles.createIndex({ code: 1 }, { unique: true, name: 'uniq_code' });
  appDb.permissions.createIndex({ resource: 1, action: 1 }, { unique: true, name: 'uniq_resource_action' });
  appDb.rolebindings.createIndex({ userId: 1, roleId: 1, scope: 1 }, { unique: true, name: 'uniq_binding' });

  appDb.sessions.createIndex({ userId: 1 }, { name: 'by_user' });
  appDb.sessions.createIndex({ refreshTokenHash: 1 }, { unique: true, sparse: true, name: 'uniq_refresh' });
  appDb.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires' });

  appDb.auditlogs.createIndex({ occurredAt: -1 }, { name: 'by_time' });
  appDb.auditlogs.createIndex({ actorId: 1, occurredAt: -1 }, { name: 'by_actor' });
  appDb.auditlogs.createIndex({ action: 1, occurredAt: -1 }, { name: 'by_action' });

  appDb.settings.createIndex({ key: 1, scope: 1, scopeId: 1 }, { unique: true, name: 'uniq_setting_scope' });

  print('[mongo-init] Baseline indexes created on database "' + dbName + '".');
})();
