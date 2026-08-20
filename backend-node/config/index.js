'use strict';

/**
 * Single source of truth for runtime configuration.
 *
 * Every environment variable the application reads is declared and validated
 * here exactly once. Nothing else in the codebase may touch `process.env`
 * directly - that rule is what makes the configuration surface auditable and
 * lets `npm run verify:modules` prove a deployment is complete before it
 * starts serving traffic.
 *
 * The process exits on an invalid configuration. Failing at boot is always
 * cheaper than failing on the first request that happens to need the value.
 */

const Joi = require('joi');

const TIERS = ['local', 'preproduction', 'production'];

const schema = Joi.object({
  // --- Runtime ---------------------------------------------------------------
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  APP_ENV: Joi.string().valid(...TIERS, 'test').default('local'),
  PORT: Joi.number().port().default(8080),
  TRUST_PROXY: Joi.string().default('loopback'),

  // --- Project identity ------------------------------------------------------
  PROJECT_CODE: Joi.string()
    .pattern(/^[a-z][a-z0-9-]{1,30}$/)
    .default('app'),
  PROJECT_NAME: Joi.string().default('Application'),
  PROJECT_DESCRIPTION: Joi.string().allow('').default(''),
  PROJECT_VERSION: Joi.string().default('1.0.0'),
  PROJECT_ORGANIZATION: Joi.string().allow('').default(''),

  // Seed values for the branding and localisation settings. Once an
  // administrator changes a setting the stored value wins; these only decide
  // what a fresh deployment starts as.
  BRANDING_PRIMARY_COLOR: Joi.string()
    .pattern(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .default('#2563eb'),
  DEFAULT_LOCALE: Joi.string().valid('th', 'en').default('en'),

  // --- Datastores ------------------------------------------------------------
  MONGO_URI: Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).required(),
  MONGO_MAX_POOL_SIZE: Joi.number().min(1).default(20),
  MONGO_MIN_POOL_SIZE: Joi.number().min(0).default(2),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: Joi.number().default(10000),

  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  REDIS_KEY_PREFIX: Joi.string().default(''),

  // --- HTTP ------------------------------------------------------------------
  API_PREFIX: Joi.string().default('/api/v1'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  BODY_LIMIT: Joi.string().default('2mb'),
  REQUEST_TIMEOUT_MS: Joi.number().default(30000),

  RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
  RATE_LIMIT_MAX: Joi.number().default(300),
  AUTH_RATE_LIMIT_MAX: Joi.number().default(10),

  // --- Authentication --------------------------------------------------------
  // Access tokens are short-lived, stateless and signed with the secret below.
  // Refresh tokens are NOT signed: they are 48 random bytes stored as a hash
  // against a session document, which is what makes them revocable. So there
  // is no second signing secret to keep - the old JWT_REFRESH_SECRET was
  // required at boot, never read by anything, and its comment claimed the two
  // had to differ, a rule nothing checked because nothing used it.
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().default('platform'),
  JWT_AUDIENCE: Joi.string().default('platform-api'),
  ACCESS_TOKEN_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().default(14),

  COOKIE_SECRET: Joi.string().min(16).required(),
  COOKIE_DOMAIN: Joi.string().allow('').default(''),
  COOKIE_SECURE: Joi.boolean().default(false),
  COOKIE_SAME_SITE: Joi.string().valid('strict', 'lax', 'none').default('lax'),

  // AES-256-GCM key for encrypting settings marked `secret: true` at rest.
  ENCRYPTION_KEY: Joi.string().min(32).required(),

  PASSWORD_MIN_LENGTH: Joi.number().min(8).default(12),
  PASSWORD_HISTORY_SIZE: Joi.number().min(0).default(5),
  MAX_LOGIN_ATTEMPTS: Joi.number().min(1).default(5),
  LOCKOUT_DURATION_MINUTES: Joi.number().min(1).default(15),

  // --- Identity providers ----------------------------------------------------
  // `local` is always available. Additional providers are activated by
  // listing them here and supplying their settings via the settings module.
  IDENTITY_PROVIDERS: Joi.string().default('local'),
  OIDC_ISSUER_URL: Joi.string().allow('').default(''),
  OIDC_CLIENT_ID: Joi.string().allow('').default(''),
  OIDC_CLIENT_SECRET: Joi.string().allow('').default(''),
  OIDC_REDIRECT_URI: Joi.string().allow('').default(''),
  OIDC_SCOPE: Joi.string().default('openid profile email'),

  // --- Observability ---------------------------------------------------------
  // 'silent' disables output entirely - used by the test bootstrap.
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent').default('info'),
  LOG_PRETTY: Joi.boolean().default(false),
  LOG_REDACT_EXTRA: Joi.string().allow('').default(''),

  SWAGGER_ENABLED: Joi.boolean().default(false),
  METRICS_ENABLED: Joi.boolean().default(true),

  // --- Security / compliance -------------------------------------------------
  AUDIT_RETENTION_DAYS: Joi.number().min(1).default(365),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: Joi.number().min(1).default(720),
  SESSION_IDLE_TIMEOUT_MINUTES: Joi.number().min(1).default(60),

  // --- Modules ---------------------------------------------------------------
  // Empty means "load everything discovered on disk". Use the deny list to
  // switch a module off in a specific tier without deleting its code.
  MODULES_ENABLED: Joi.string().allow('').default(''),
  MODULES_DISABLED: Joi.string().allow('').default(''),

  // --- Bootstrap seed --------------------------------------------------------
  // Read only by `npm run seed`, and only when the database has no users.
  // Declared here so no code outside this file has to touch process.env.
  BOOTSTRAP_ADMIN_EMAIL: Joi.string().email({ tlds: false }).default('admin@example.com'),
  BOOTSTRAP_ADMIN_NAME: Joi.string().default('Administrator'),
  BOOTSTRAP_ADMIN_PASSWORD: Joi.string().allow('').default(''),

  // --- Mail ------------------------------------------------------------------
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().allow('').default('')
})
  // Unknown keys are permitted: modules and the platform image legitimately
  // inject variables this schema does not need to know about.
  .unknown(true);

const { value: env, error } = schema.validate(process.env, {
  abortEarly: false,
  convert: true
});

if (error) {
  const details = error.details.map((d) => `  - ${d.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${details}\n`);
  process.exit(1);
}

function toList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const isProduction = env.APP_ENV === 'production';

// Production must never fall back to a permissive CORS policy.
const corsOrigins = toList(env.CORS_ORIGINS);
if (isProduction && corsOrigins.length === 0) {
  // eslint-disable-next-line no-console
  console.error('CORS_ORIGINS must be set explicitly in production.');
  process.exit(1);
}

const config = {
  env: {
    nodeEnv: env.NODE_ENV,
    appEnv: env.APP_ENV,
    isLocal: env.APP_ENV === 'local',
    isPreproduction: env.APP_ENV === 'preproduction',
    isProduction,
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    trustProxy: env.TRUST_PROXY
  },

  project: {
    code: env.PROJECT_CODE,
    name: env.PROJECT_NAME,
    description: env.PROJECT_DESCRIPTION,
    version: env.PROJECT_VERSION,
    organization: env.PROJECT_ORGANIZATION
  },

  branding: {
    primaryColor: env.BRANDING_PRIMARY_COLOR,
    defaultLocale: env.DEFAULT_LOCALE
  },

  http: {
    apiPrefix: env.API_PREFIX,
    corsOrigins,
    bodyLimit: env.BODY_LIMIT,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      authMax: env.AUTH_RATE_LIMIT_MAX
    }
  },

  mongo: {
    uri: env.MONGO_URI,
    options: {
      maxPoolSize: env.MONGO_MAX_POOL_SIZE,
      minPoolSize: env.MONGO_MIN_POOL_SIZE,
      serverSelectionTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS
    }
  },

  redis: {
    url: env.REDIS_URL,
    keyPrefix: env.REDIS_KEY_PREFIX || `${env.PROJECT_CODE}:`
  },

  auth: {
    accessSecret: env.JWT_ACCESS_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    providers: toList(env.IDENTITY_PROVIDERS),
    password: {
      minLength: env.PASSWORD_MIN_LENGTH,
      historySize: env.PASSWORD_HISTORY_SIZE,
      maxLoginAttempts: env.MAX_LOGIN_ATTEMPTS,
      lockoutMinutes: env.LOCKOUT_DURATION_MINUTES
    },
    session: {
      absoluteTimeoutHours: env.SESSION_ABSOLUTE_TIMEOUT_HOURS,
      idleTimeoutMinutes: env.SESSION_IDLE_TIMEOUT_MINUTES
    }
  },

  oidc: {
    issuerUrl: env.OIDC_ISSUER_URL,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI,
    scope: env.OIDC_SCOPE
  },

  cookie: {
    secret: env.COOKIE_SECRET,
    domain: env.COOKIE_DOMAIN,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE
  },

  crypto: {
    encryptionKey: env.ENCRYPTION_KEY
  },

  observability: {
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    logRedactExtra: toList(env.LOG_REDACT_EXTRA),
    swaggerEnabled: env.SWAGGER_ENABLED,
    metricsEnabled: env.METRICS_ENABLED
  },

  compliance: {
    auditRetentionDays: env.AUDIT_RETENTION_DAYS
  },

  modules: {
    enabled: toList(env.MODULES_ENABLED),
    disabled: toList(env.MODULES_DISABLED)
  },

  bootstrap: {
    adminEmail: String(env.BOOTSTRAP_ADMIN_EMAIL).toLowerCase(),
    adminName: env.BOOTSTRAP_ADMIN_NAME,
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD
  },

  mail: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.MAIL_FROM
  }
};

module.exports = Object.freeze(config);
