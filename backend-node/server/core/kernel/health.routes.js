'use strict';

/**
 * Liveness and readiness probes.
 *
 * Deliberately unauthenticated and deliberately terse: the response tells an
 * orchestrator whether to route traffic here, and nothing an attacker could
 * use to fingerprint the deployment. Version and dependency detail are behind
 * the authenticated /platform/info endpoint instead.
 */

const express = require('express');

const database = require('../db/connection');
const cache = require('../db/cache');

const router = express.Router();

/** Liveness: is the process running? Never touches a dependency. */
router.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/** Readiness: can this instance serve traffic right now? */
router.get('/readyz', async (req, res) => {
  const checks = {
    mongo: database.isHealthy(),
    redis: cache.isHealthy()
  };

  // Redis degrades gracefully - a cache outage slows the API but does not
  // make it incorrect, so it does not fail readiness. Mongo does.
  const ready = checks.mongo;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    checks
  });
});

module.exports = router;

