'use strict';

/**
 * Purges audit entries past the configured retention window.
 *
 * Deletes in batches so a large backlog cannot hold a write lock long enough
 * to affect request latency.
 */

const mongoose = require('mongoose');
const settingsService = require('../../../core/settings/settings-service');
const logger = require('../../../../config/logger').forModule('audit-retention');

const BATCH_SIZE = 5000;

module.exports = async function auditRetentionJob() {
  const retentionDays = await settingsService.get('security.audit.retentionDays');
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const AuditLog = mongoose.model('AuditLog');
  let removed = 0;

  for (;;) {
    const batch = await AuditLog.find({ occurredAt: { $lt: cutoff } })
      .select('_id')
      .limit(BATCH_SIZE)
      .lean();

    if (!batch.length) break;

    const result = await AuditLog.deleteMany({ _id: { $in: batch.map((row) => row._id) } });
    removed += result.deletedCount || 0;

    if (batch.length < BATCH_SIZE) break;
  }

  if (removed) logger.info({ removed, cutoff, retentionDays }, 'Audit retention purge complete');
  return { removed, cutoff };
};
