'use strict';

/**
 * Every tracked file whose content starts with `#!` must be executable in the
 * git index.
 *
 * The bug this exists to prevent: `scripts/compose.sh` sat in the index as
 * mode 100644. Windows reports an executable bit that is not really there, so
 * `make up` worked on the machine the template is written on and died with
 * "Permission denied" on every Linux clone - and `Makefile` opens with
 * `COMPOSE := ./scripts/compose.sh`, so that is most of the developer entry
 * points. Three separate projects hit it and each fixed it locally, none of
 * them at the source, because nothing here ever looked at the index.
 *
 * The index is what other people receive, and on Windows it is the only mode
 * worth trusting - which is why this reads git rather than the working tree.
 *
 *   node backend-node/scripts/verify-exec-bits.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

let entries;
try {
  entries = execFileSync('git', ['ls-files', '-s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .split('\n')
    .filter(Boolean);
} catch {
  // A generated project is not a git repository until someone runs `git init`,
  // and `make verify` is expected to work before that. Nothing to check here,
  // and nothing wrong.
  console.log('exec bits: not a git repository, skipping');
  process.exit(0);
}

function startsWithShebang(absolute) {
  let fd;
  try {
    fd = fs.openSync(absolute, 'r');
  } catch {
    return false; // tracked but not in the working tree right now
  }

  try {
    const buffer = Buffer.alloc(2);
    const read = fs.readSync(fd, buffer, 0, 2, 0);
    return read === 2 && buffer.toString('latin1') === '#!';
  } finally {
    fs.closeSync(fd);
  }
}

const offenders = [];

for (const line of entries) {
  const match = line.match(/^(\d{6}) [0-9a-f]+ \d\t(.+)$/);
  if (!match) continue;

  const [, mode, file] = match;
  if (mode !== '100644') continue;

  if (startsWithShebang(path.join(repoRoot, file))) offenders.push(file);
}

if (offenders.length > 0) {
  console.error('These files start with #! but are not executable in the git index:');
  for (const file of offenders) console.error(`  ${file}`);
  console.error('');
  console.error('Fix them at the source, so every clone and every generated project gets it right:');
  for (const file of offenders) console.error(`  git update-index --chmod=+x ${file}`);
  process.exit(1);
}

console.log(`exec bits: ok (${entries.length} tracked files checked)`);
