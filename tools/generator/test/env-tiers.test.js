'use strict';

/**
 * Regression test for the generated env files.
 *
 * The bug this exists to prevent: every tier was being rendered from
 * `.env.example`, which is local-shaped. A generated project's
 * `.env.production` therefore said `APP_ENV=local`, `SWAGGER_ENABLED=true`,
 * `COOKIE_SECURE=false` and pointed CORS at localhost - a development config
 * wearing a production filename, which passed every other check in the repo.
 *
 *   node --test tools/generator/test/env-tiers.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generate } = require('../src/generate');
const tokens = require('../src/tokens');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', '..');

function parseEnv(filePath) {
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function generateInto(overrides = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-gen-'));
  fs.rmSync(outputDir, { recursive: true, force: true });

  const { values } = tokens.resolve({ PROJECT_CODE: 'probe', PROJECT_NAME: 'Probe' });

  await generate(
    Object.assign(
      {
        templateRoot: TEMPLATE_ROOT,
        outputDir,
        values,
        dryRun: false,
        log() {}
      },
      overrides
    )
  );

  return outputDir;
}

test('generated production env keeps the production hardening', async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const env = parseEnv(path.join(dir, 'backend-node', '.env.production'));

  assert.equal(env.APP_ENV, 'production', 'tier must not fall back to local');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.SWAGGER_ENABLED, 'false', 'the API schema is reconnaissance data');
  assert.equal(env.COOKIE_SECURE, 'true');
  assert.equal(env.COOKIE_SAME_SITE, 'strict');
  assert.equal(env.LOG_LEVEL, 'warn');
  assert.equal(env.TRUST_PROXY, '1');
});

test('generated preproduction env keeps the preproduction shape', async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const env = parseEnv(path.join(dir, 'backend-node', '.env.preproduction'));

  assert.equal(env.APP_ENV, 'preproduction');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.COOKIE_SECURE, 'true');
  // Preproduction deliberately keeps the schema available for QA.
  assert.equal(env.SWAGGER_ENABLED, 'true');
});

test('deploy tiers carry no leftover secret, and no template hostname', async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const tier of ['preproduction', 'production']) {
    const env = parseEnv(path.join(dir, 'backend-node', `.env.${tier}`));

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'ENCRYPTION_KEY', 'MONGO_URI', 'REDIS_URL']) {
      assert.equal(env[key], 'CHANGE_ME', `${tier}: ${key} must stay a placeholder`);
    }

    // Without --domain these must not inherit the template's example host.
    assert.equal(env.CORS_ORIGINS, 'CHANGE_ME', `${tier}: CORS must not default to a hostname`);
    assert.equal(env.COOKIE_DOMAIN, 'CHANGE_ME');
    assert.equal(env.BOOTSTRAP_ADMIN_EMAIL, 'CHANGE_ME');

    assert.ok(!JSON.stringify(env).includes('myapp'), `${tier} still references the template project code`);
  }
});

test('--domain fills the deploy-tier hostnames', async (t) => {
  const dir = await generateInto({ domain: 'probe.example.org', registry: 'registry.example.org' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prod = parseEnv(path.join(dir, 'backend-node', '.env.production'));
  const preprod = parseEnv(path.join(dir, 'backend-node', '.env.preproduction'));
  const rootProd = parseEnv(path.join(dir, '.env.production'));

  assert.equal(prod.CORS_ORIGINS, 'https://probe.example.org');
  assert.equal(prod.COOKIE_DOMAIN, 'probe.example.org');
  assert.equal(preprod.COOKIE_DOMAIN, 'preprod.probe.example.org');
  assert.equal(rootProd.REGISTRY, 'registry.example.org');
});

test('local tier gets real generated secrets, not placeholders', async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const env = parseEnv(path.join(dir, 'backend-node', '.env.local'));

  assert.equal(env.APP_ENV, 'local');
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'ENCRYPTION_KEY']) {
    assert.notEqual(env[key], 'CHANGE_ME', `${key} should be generated for local`);
    assert.ok(env[key].length >= 16, `${key} looks too short`);
  }

  // The two JWT secrets must differ, or a leaked access secret can mint
  // refresh tokens.
  assert.notEqual(env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET);

  // The connection strings must name the child project, not the template.
  assert.match(env.MONGO_URI, /probe_app.*probe_local/);
  assert.equal(env.JWT_AUDIENCE, 'probe-api');
});
