'use strict';

/**
 * Regression test for the provenance a generated project records.
 *
 * The gap this exists to close: `project.manifest.json` recorded
 * `templateVersion` and a timestamp and nothing else. `templateVersion` is
 * maintained by hand and had not moved across eight commits, so there was no
 * way to tell whether a file that differs from the template was changed by the
 * project or changed by the template afterwards - which is exactly the question
 * asked when a bug turns out to have come from upstream.
 *
 * Generation reads the working tree, not the last commit, so the dirty flag is
 * part of the record: without it the commit would name a tree the child was
 * never generated from.
 *
 *   node --test tools/generator/test/template-provenance.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generate } = require('../src/generate');
const tokens = require('../src/tokens');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', '..');

function headOfTemplate() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: TEMPLATE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null; // not a git checkout, or no git - both are allowed
  }
}

async function generateInto() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-prov-'));
  fs.rmSync(outputDir, { recursive: true, force: true });

  const { values } = tokens.resolve({ PROJECT_CODE: 'probe', PROJECT_NAME: 'Probe' });

  await generate({
    templateRoot: TEMPLATE_ROOT,
    outputDir,
    values,
    dryRun: false,
    log() {}
  });

  return outputDir;
}

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'project.manifest.json'), 'utf8'));
}

test('the child records the template commit it was generated from', async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { generatedFrom } = readManifest(dir);
  const head = headOfTemplate();

  assert.ok('templateCommit' in generatedFrom, 'generatedFrom must carry templateCommit');

  if (head === null) {
    assert.equal(generatedFrom.templateCommit, null, 'no git checkout means a null commit, not a guess');
    return;
  }

  assert.equal(generatedFrom.templateCommit, head, 'the recorded commit must be the template HEAD');
  assert.match(generatedFrom.templateCommit, /^[0-9a-f]{40}$/, 'a full sha, not an abbreviation');
});

test('the child records whether the template had uncommitted changes', async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { generatedFrom } = readManifest(dir);

  assert.ok('templateTreeDirty' in generatedFrom, 'generatedFrom must carry templateTreeDirty');

  const expected = headOfTemplate() === null ? 'object' : 'boolean';
  assert.equal(typeof generatedFrom.templateTreeDirty, expected);
});

test('the upgrade note points at the commit, not the hand-maintained version', async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { upgrade } = readManifest(dir);
  assert.match(upgrade.note, /templateCommit/);
  assert.match(upgrade.note, /templateTreeDirty/);
});
