'use strict';

/**
 * Test discovery and runner.
 *
 * `node --test` only learned to expand glob patterns in Node 22, and this
 * project pins Node 20 (see .nvmrc), where a pattern is taken literally and a
 * path that matches nothing is fatal. Passing a directory instead is not an
 * option either: `node --test <dir>` misbehaves on Windows, and the team is
 * not all on one platform. So discovery happens here, in plain `fs`, and the
 * runner receives an explicit file list that every supported version and
 * platform understands the same way.
 *
 * A search root that holds no tests is skipped rather than fatal. `server/`
 * exists so a module can keep its tests beside the code they cover; a project
 * that has not written one there yet is not a broken project. Before this
 * script that distinction did not exist, and an empty `server/` failed the
 * entire suite.
 *
 * Zero tests anywhere is still an error - that is a broken project.
 *
 *   npm test
 *   npm test -- --watch
 *   npm test -- --experimental-test-coverage
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = ['server', 'test'];
const TEST_FILE = /\.test\.js$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist', 'build']);

/** Recursively collects `*.test.js` beneath `dir`, relative to the package root. */
function collect(dir, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // a root that does not exist is simply not searched
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(full, found);
    } else if (TEST_FILE.test(entry.name)) {
      // Posix separators: passed to node as arguments, and consistent output
      // matters more than matching the host's convention.
      found.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }

  return found;
}

const files = SEARCH_ROOTS.flatMap((root) => collect(path.join(ROOT, root), [])).sort();

if (!files.length) {
  console.error(`No *.test.js files found under: ${SEARCH_ROOTS.join(', ')}`);
  process.exit(1);
}

const passthrough = process.argv.slice(2);
const args = ['-r', './test/setup.js', '--test'];

// Callers can override the reporter; only supply the default when they have not.
if (!passthrough.some((arg) => arg.startsWith('--test-reporter'))) {
  args.push('--test-reporter=spec');
}

args.push(...passthrough, ...files);

console.log(`Running ${files.length} test file(s)`);

const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
