'use strict';

/**
 * Test bootstrap, preloaded with `node -r ./test/setup.js --test`.
 *
 * Populates the environment before `config/index.js` validates it, so a test
 * file can require a manifest, a route or a service without every test having
 * to stand up a full environment first.
 *
 * The values are obvious throwaways. Tests that need a real database use
 * mongodb-memory-server and override MONGO_URI themselves.
 */

const defaults = {
  NODE_ENV: 'test',
  APP_ENV: 'local',
  PORT: '0',

  PROJECT_CODE: 'test',
  PROJECT_NAME: 'Test',
  PROJECT_VERSION: '0.0.0-test',

  MONGO_URI: 'mongodb://127.0.0.1:27017/test',
  REDIS_URL: 'redis://127.0.0.1:6379',

  JWT_ACCESS_SECRET: 'test-access-secret-not-used-in-any-real-deployment',
  COOKIE_SECRET: 'test-cookie-secret-value',
  ENCRYPTION_KEY: 'test-encryption-key-32-chars-min!',

  CORS_ORIGINS: 'http://localhost:8081',
  LOG_LEVEL: 'silent',
  LOG_PRETTY: 'false',
  SWAGGER_ENABLED: 'false'
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
