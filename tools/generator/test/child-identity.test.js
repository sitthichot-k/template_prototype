'use strict';

/**
 * Regression tests for the boundary between "template" and "child project".
 *
 * The bugs these exist to prevent, all found in one generated project:
 *
 *  - The child shipped the template's own README, so a project called
 *    "Demo App" opened with a page titled *Enterprise Platform Template* whose
 *    first instruction was to run a generator the child does not contain.
 *  - The child's `Makefile` kept a `new:` target invoking
 *    `tools/generator/bin/create-project.js`, which `.templateignore` excludes.
 *    `make new` in a child failed with a missing-file error.
 *  - `--frontend both` skipped the nginx step entirely, so neither frontend
 *    received the `nginx/default.conf` its Dockerfile copies from its build
 *    context. Both production images failed to build.
 *
 *   node --test tools/generator/test/child-identity.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generate } = require('../src/generate');
const tokens = require('../src/tokens');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', '..');

async function generateInto(overrides = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-child-'));
  fs.rmSync(outputDir, { recursive: true, force: true });

  const { values } = tokens.resolve({ PROJECT_CODE: 'probe', PROJECT_NAME: 'Probe System' });

  await generate(
    Object.assign({ templateRoot: TEMPLATE_ROOT, outputDir, values, dryRun: false, log() {} }, overrides)
  );

  return outputDir;
}

function read(outputDir, relative) {
  return fs.readFileSync(path.join(outputDir, relative), 'utf8');
}

test('the child README describes the child, not the template', async () => {
  const outputDir = await generateInto();
  const readme = read(outputDir, 'README.md');

  assert.match(readme, /^# Probe System/, 'README must be titled after the project');
  assert.doesNotMatch(readme, /^# Enterprise Platform Template/m);
  assert.doesNotMatch(
    readme,
    /create-project\.js/,
    'the child has no generator, so its README must not instruct anyone to run one'
  );

  // It still has to be a usable README, not merely a renamed one.
  assert.match(readme, /make up/);
  assert.match(readme, /make seed/);
  assert.match(readme, /CHANGE_ME/, 'the deploy-tier placeholders must be called out');

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('template-only regions do not reach the child', async () => {
  const outputDir = await generateInto();
  const makefile = read(outputDir, 'Makefile');

  assert.doesNotMatch(makefile, /create-project\.js/, 'the generator target must be stripped');
  assert.doesNotMatch(makefile, /template-only/, 'the markers themselves must not survive');

  // Stripping must remove the marked region and nothing else.
  assert.match(makefile, /^up:/m);
  assert.match(makefile, /^verify:/m);
  assert.match(makefile, /^prod-up:/m);

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('no template-authoring material reaches the child', async () => {
  const outputDir = await generateInto();

  for (const excluded of ['tools/generator', 'template.manifest.json', 'docs/prd', '.claude']) {
    assert.equal(
      fs.existsSync(path.join(outputDir, excluded)),
      false,
      `${excluded} describes the template and must not travel`
    );
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('inherited decision records are kept but marked as inherited', async () => {
  const outputDir = await generateInto();

  const inherited = fs.readdirSync(path.join(outputDir, 'docs', 'adr', 'inherited'));
  assert.ok(
    inherited.filter((name) => /^\d{4}-/.test(name)).length >= 6,
    'the platform decision records must survive - the child will ask the same questions'
  );

  // The child's own series starts empty, so record 0001 is the team's own.
  const own = fs
    .readdirSync(path.join(outputDir, 'docs', 'adr'))
    .filter((name) => /^\d{4}-/.test(name));
  assert.deepEqual(own, [], "the child's own ADR series must start empty");

  const index = read(outputDir, 'docs/adr/README.md');
  assert.match(index, /Probe System/, 'the index must name the project it belongs to');
  assert.match(index, /inherited\//);

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('the frontend gets its nginx build context', async () => {
  const outputDir = await generateInto();

  assert.equal(
    fs.existsSync(path.join(outputDir, 'frontend-vue', 'nginx', 'default.conf')),
    true,
    'frontend-vue/nginx/default.conf must exist or the production image cannot build'
  );

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('the retired React shell leaves nothing behind', async () => {
  const outputDir = await generateInto();

  assert.equal(fs.existsSync(path.join(outputDir, 'frontend-react')), false);

  // A stale FRONTEND_CONTEXT would build a directory that no longer exists.
  const env = fs.readFileSync(path.join(outputDir, '.env.local'), 'utf8');
  assert.doesNotMatch(env, /frontend-react/);

  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'project.manifest.json'), 'utf8'));
  assert.equal(manifest.frontend, 'frontend-vue');

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('an unterminated template-only region fails loudly', () => {
  assert.throws(
    () => tokens.stripTemplateOnly('a\n# >>> template-only\nb\nc\n', 'Makefile'),
    /Unterminated "template-only" region opened at Makefile:2/,
    'silently truncating the rest of the file would be found far too late'
  );
});
