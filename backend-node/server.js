'use strict';

/**
 * Process entry point.
 *
 * Responsibilities are deliberately narrow: build the application, open the
 * listener, and own the shutdown sequence. Everything else lives in the
 * kernel (server/core/kernel) so the same application can be booted by tests
 * without touching a port.
 */

const http = require('http');

const config = require('./config');
const logger = require('./config/logger');
const { createApplication } = require('./server/core/kernel/application');
const database = require('./server/core/db/connection');
const cache = require('./server/core/db/cache');

const SHUTDOWN_TIMEOUT_MS = 30000;

async function main() {
  logger.info(
    { app: config.project.code, env: config.env.appEnv, version: config.project.version },
    'Starting application'
  );

  await database.connect();
  await cache.connect();

  const { app, kernel } = await createApplication();
  const server = http.createServer(app);

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  await new Promise((resolve) => server.listen(config.env.port, resolve));

  logger.info(
    {
      port: config.env.port,
      modules: kernel.registry.listModuleIds(),
      routes: kernel.registry.countRoutes()
    },
    'Application ready'
  );

  registerShutdownHandlers(server, kernel);
}

function registerShutdownHandlers(server, kernel) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutdown requested');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out - forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await new Promise((resolve) => server.close(resolve));
      await kernel.shutdown();
      await cache.disconnect();
      await database.disconnect();
      clearTimeout(forceExit);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // An unhandled rejection leaves the process in an undefined state; log it
  // and exit so the orchestrator can replace the container.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start application');
  process.exit(1);
});
