'use strict';

/**
 * Regression test for the executable bit on generated shell scripts.
 *
 * The bug this exists to prevent: `copyFile` writes every text file with
 * `fs.writeFileSync`, which creates it 0644 regardless of the source's mode.
 * The template's own `scripts/compose.sh` could be perfectly executable and
 * the child would still come out unrunnable - and `Makefile` opens with
 * `COMPOSE := ./scripts/compose.sh`, so `make up` and `make verify` both died
 * with "Permission denied" on every generated project.
 *
 * Fixing the template's index alone does not fix this; the two are separate
 * causes with the same symptom, which is why they have separate guards.
 *
 * Windows cannot express the bit at all, so the assertions are skipped there
 * rather than failing for a reason that has nothing to do with the code.
 *
 *   node --test tools/generator/test/executable-bits.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generate } = require('../src/generate');
const tokens = require('../src/tokens');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKIP = process.platform === 'win32' ? 'POSIX file modes only' : false;

async function generateInto() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-exec-'));
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

function startsWithShebang(absolute) {
  const fd = fs.openSync(absolute, 'r');
  try {
    const buffer = Buffer.alloc(2);
    const read = fs.readSync(fd, buffer, 0, 2, 0);
    return read === 2 && buffer.toString('latin1') === '#!';
  } finally {
    fs.closeSync(fd);
  }
}

test('the compose wrapper a generated project runs is executable', { skip: SKIP }, async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const script = path.join(dir, 'scripts', 'compose.sh');
  assert.ok(fs.existsSync(script), 'scripts/compose.sh should reach the child');
  assert.equal(
    fs.statSync(script).mode & 0o111,
    0o111,
    'scripts/compose.sh must be executable - Makefile calls it for every make target'
  );
});

test('no generated file starts with #! without being executable', { skip: SKIP }, async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const offenders = [];

  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;

      const absolute = path.join(current, entry.name);
      if (!startsWithShebang(absolute)) continue;
      if ((fs.statSync(absolute).mode & 0o111) !== 0o111) {
        offenders.push(path.relative(dir, absolute));
      }
    }
  })(dir);

  assert.deepEqual(offenders, [], `generated but not executable: ${offenders.join(', ')}`);
});

test('a file without a shebang is left alone', { skip: SKIP }, async (t) => {
  const dir = await generateInto();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The PowerShell wrapper is the pair of compose.sh and carries no shebang;
  // Windows does not use the bit, so granting it would be noise in the diff.
  const mode = fs.statSync(path.join(dir, 'scripts', 'compose.ps1')).mode;
  assert.equal(mode & 0o111, 0, 'compose.ps1 should not be marked executable');
});
