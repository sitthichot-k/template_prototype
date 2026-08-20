'use strict';

/**
 * Application factory - assembles the Express app from the module registry.
 *
 * Nothing here knows the name of any feature module. The boot sequence is
 * fixed and generic:
 *
 *   1. platform middleware        (security headers, parsing, correlation id)
 *   2. liveness / readiness       (must answer before modules are ready)
 *   3. discover + register modules
 *   4. onBoot hooks               (schema sync, cache warm-up)
 *   5. mount module routers under the API prefix
 *   6. onReady hooks              (permission sync, job scheduling)
 *   7. 404 + error handling       (always last)
 *
 * Exported separately from `server.js` so tests can build the app without
 * binding a port.
 */

const express = require('express');

const config = require('../../../config');
const logger = require('../../../config/logger').forModule('kernel');
const ModuleRegistry = require('./module-registry');
const { loadModules } = require('./module-loader');
const platformMiddleware = require('../../../middleware');
const { errorHandler, notFoundHandler } = require('../http/error-handler');
const healthRouter = require('./health.routes');

class Kernel {
  constructor() {
    this.registry = new ModuleRegistry();
    this.manifests = [];
  }

  async runHook(name, context) {
    for (const manifest of this.manifests) {
      const hook = manifest.hooks && manifest.hooks[name];
      if (typeof hook !== 'function') continue;
      const started = Date.now();
      try {
        await hook(context);
        logger.debug({ module: manifest.id, hook: name, ms: Date.now() - started }, 'Module hook completed');
      } catch (error) {
        logger.error({ err: error, module: manifest.id, hook: name }, 'Module hook failed');
        // A failed onShutdown must not prevent the remaining modules from
        // cleaning up; a failed boot hook is fatal.
        if (name !== 'onShutdown') throw error;
      }
    }
  }

  async shutdown() {
    await this.runHook('onShutdown', { registry: this.registry, config, logger });
  }
}

async function createApplication() {
  const app = express();
  const kernel = new Kernel();

  app.set('trust proxy', config.env.trustProxy);
  app.set('etag', false);
  app.disable('x-powered-by');

  // 1. Platform middleware
  platformMiddleware.apply(app);

  // 2. Health endpoints live outside the API prefix and outside auth so an
  //    orchestrator can probe them before the application is fully ready.
  app.use('/', healthRouter);

  // 3. Modules
  kernel.manifests = await loadModules(kernel.registry);

  const context = { app, registry: kernel.registry, config, logger };

  // 4. Boot hooks
  await kernel.runHook('onBoot', context);

  // 5. Routes
  const apiRouter = express.Router();
  for (const route of kernel.registry.routes) {
    apiRouter.use(route.basePath, route.router);
    logger.debug(
      { module: route.moduleId, path: `${config.http.apiPrefix}${route.basePath}` },
      'Route mounted'
    );
  }
  app.use(config.http.apiPrefix, apiRouter);

  // 6. Optional API documentation. Off in production by contract - the schema
  //    describes every endpoint and permission, which is reconnaissance data.
  if (config.observability.swaggerEnabled) {
    // eslint-disable-next-line global-require
    const { mountSwagger } = require('../../../config/swagger');
    mountSwagger(app, kernel.registry);
    logger.info({ path: '/docs' }, 'API documentation enabled');
  }

  // 7. Ready hooks - modules may now rely on routes being mounted.
  await kernel.runHook('onReady', context);

  // 8. Terminal handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, kernel };
}

module.exports = { createApplication, Kernel };
