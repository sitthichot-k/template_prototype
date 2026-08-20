'use strict';

/**
 * Replaces the sparse unique index on `users.username` with a partial one.
 *
 * The original index was `{ unique: true, sparse: true }`. A sparse index only
 * skips documents where the key is *absent*, but the schema defaults
 * `username` to `null`, so every account without a username carried the same
 * indexed value. The first such account was fine; the second was rejected as a
 * duplicate - which meant an administrator could create exactly one user
 * before the endpoint started returning 409.
 *
 * Restricting the index to documents whose `username` is an actual string is
 * the correct form, and leaves the uniqueness guarantee intact for accounts
 * that do have one.
 *
 * Migration 001 now creates the index in its fixed form, so this only matters
 * for databases provisioned before that change.
 */

const INDEX_NAME = 'uniq_username';

module.exports = {
  async up(db) {
    const users = db.collection('users');

    const existing = await users.indexes();
    const current = existing.find((index) => index.name === INDEX_NAME);

    // Already partial: nothing to do. Keeps the migration idempotent.
    if (current && current.partialFilterExpression) return;

    if (current) await users.dropIndex(INDEX_NAME);

    await users.createIndex(
      { username: 1 },
      {
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: { username: { $type: 'string' } }
      }
    );
  },

  /**
   * Restores the sparse form. Only succeeds when at most one account has a
   * null username - which is exactly the state the broken index required, so
   * a failure here is the migration correctly refusing to recreate a bug on a
   * database that has since outgrown it.
   */
  async down(db) {
    const users = db.collection('users');

    const existing = await users.indexes();
    if (existing.some((index) => index.name === INDEX_NAME)) {
      await users.dropIndex(INDEX_NAME);
    }

    await users.createIndex({ username: 1 }, { name: INDEX_NAME, unique: true, sparse: true });
  }
};
