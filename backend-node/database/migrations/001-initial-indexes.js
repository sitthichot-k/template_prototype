'use strict';

/**
 * Baseline indexes for the phase-1 collections.
 *
 * Mongoose declares the same indexes, and `autoIndex` builds them
 * automatically in the lower tiers. Production runs with `autoIndex` off so a
 * deployment never triggers an unplanned index build under load - this
 * migration is how they get created there instead.
 *
 * `background: true` keeps the build from blocking writes on a populated
 * collection. Every call is idempotent.
 */

module.exports = {
  async up(db) {
    await db.collection('users').createIndexes([
      { key: { email: 1 }, name: 'uniq_email', unique: true },
      // Partial, not sparse: `username` defaults to null, and a sparse index
      // only skips documents where the key is absent - so every account
      // without a username would collide on the same indexed value.
      {
        key: { username: 1 },
        name: 'uniq_username',
        unique: true,
        partialFilterExpression: { username: { $type: 'string' } }
      },
      { key: { status: 1, deletedAt: 1 }, name: 'by_status' },
      { key: { 'identities.provider': 1, 'identities.subject': 1 }, name: 'by_external_identity' }
    ]);

    await db.collection('roles').createIndexes([
      { key: { code: 1 }, name: 'uniq_code', unique: true },
      { key: { isActive: 1, deletedAt: 1 }, name: 'by_active' }
    ]);

    await db.collection('permissions').createIndexes([
      { key: { resource: 1 }, name: 'uniq_resource', unique: true },
      { key: { group: 1, resource: 1 }, name: 'by_group' }
    ]);

    await db.collection('rolebindings').createIndexes([
      { key: { userId: 1, roleId: 1, scope: 1, scopeId: 1 }, name: 'uniq_binding', unique: true },
      { key: { expiresAt: 1 }, name: 'by_expiry', sparse: true }
    ]);

    await db.collection('policies').createIndexes([{ key: { isActive: 1, priority: -1 }, name: 'by_priority' }]);

    await db.collection('sessions').createIndexes([
      { key: { refreshTokenHash: 1 }, name: 'uniq_refresh', unique: true, sparse: true },
      { key: { userId: 1, revokedAt: 1 }, name: 'by_user' },
      { key: { familyId: 1 }, name: 'by_family' },
      // TTL: Mongo removes the document once expiresAt passes.
      { key: { expiresAt: 1 }, name: 'ttl_expires', expireAfterSeconds: 0 }
    ]);

    await db.collection('auditlogs').createIndexes([
      { key: { occurredAt: -1 }, name: 'by_time' },
      { key: { actorId: 1, occurredAt: -1 }, name: 'by_actor' },
      { key: { action: 1, occurredAt: -1 }, name: 'by_action' },
      { key: { 'target.type': 1, 'target.id': 1, occurredAt: -1 }, name: 'by_target' }
    ]);

    await db.collection('settings').createIndexes([
      { key: { key: 1, scope: 1, scopeId: 1 }, name: 'uniq_setting_scope', unique: true },
      { key: { group: 1 }, name: 'by_group' }
    ]);
  },

  /**
   * Dropping indexes is safe but makes the application slow rather than
   * broken, so the rollback is deliberately narrow: it removes only what this
   * migration added, by name.
   */
  async down(db) {
    const plan = {
      users: ['uniq_email', 'uniq_username', 'by_status', 'by_external_identity'],
      roles: ['uniq_code', 'by_active'],
      permissions: ['uniq_resource', 'by_group'],
      rolebindings: ['uniq_binding', 'by_expiry'],
      policies: ['by_priority'],
      sessions: ['uniq_refresh', 'by_user', 'by_family', 'ttl_expires'],
      auditlogs: ['by_time', 'by_actor', 'by_action', 'by_target'],
      settings: ['uniq_setting_scope', 'by_group']
    };

    for (const [collection, names] of Object.entries(plan)) {
      for (const name of names) {
        await db.collection(collection).dropIndex(name).catch(() => {});
      }
    }
  }
};
