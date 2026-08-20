'use strict';

/**
 * Static verification of the module contract.
 *
 * Runs without a database, so it belongs in CI on every pull request. It
 * catches the failure modes that are otherwise invisible until runtime:
 *
 *   - a malformed or duplicated module manifest
 *   - a route guarded by a permission resource no module declares
 *   - a setting descriptor that fails validation
 *   - a dependency on a module that does not exist, or a dependency cycle
 *   - an async handler that is not wrapped, which would hang the request
 *   - a boot hook that reaches past the surface `scripts/seed.js` can provide
 *
 *   node scripts/verify-module-contracts.js
 */

const fs = require('fs');
const path = require('path');

// Config validation is not the subject here, and requiring the real one would
// demand a full environment. Supply the minimum so the module tree can load.
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/verify';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'x'.repeat(32);
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'z'.repeat(16);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'k'.repeat(32);
process.env.APP_ENV = 'local';

const { discoverModuleDirs, loadManifest, resolveBootOrder } = require('../server/core/kernel/module-loader');
const { validateDescriptor } = require('../server/core/settings/setting-descriptor');

const problems = [];
const warnings = [];

function fail(message) {
  problems.push(message);
}

function warn(message) {
  warnings.push(message);
}

// --- 1. Manifests load and validate ------------------------------------------
const dirs = discoverModuleDirs();
if (!dirs.length) fail('No modules found under server/modules.');

const manifests = [];
for (const dir of dirs) {
  try {
    manifests.push(loadManifest(dir));
  } catch (error) {
    fail(`${path.basename(dir)}: ${error.message}`);
  }
}

// --- 2. Unique ids ------------------------------------------------------------
const seen = new Set();
for (const manifest of manifests) {
  if (seen.has(manifest.id)) fail(`Duplicate module id "${manifest.id}".`);
  seen.add(manifest.id);
}

// --- 3. Dependencies resolve, no cycles --------------------------------------
try {
  resolveBootOrder(manifests);
} catch (error) {
  fail(error.message);
}

// --- 4. Permission catalogue --------------------------------------------------
const declared = new Set();
for (const manifest of manifests) {
  for (const permission of manifest.permissions) {
    declared.add(permission.resource);
    if (!permission.actions.length) {
      fail(`${manifest.id}: permission "${permission.resource}" declares no actions.`);
    }
  }
}

// --- 5. Settings descriptors --------------------------------------------------
const settingKeys = new Set();
for (const manifest of manifests) {
  for (const descriptor of manifest.settings) {
    try {
      const validated = validateDescriptor(descriptor);
      if (settingKeys.has(validated.key)) {
        fail(`Duplicate setting key "${validated.key}" (module "${manifest.id}").`);
      }
      settingKeys.add(validated.key);

      if (!declared.has(validated.permission.resource)) {
        fail(
          `${manifest.id}: setting "${validated.key}" requires permission resource ` +
            `"${validated.permission.resource}", which no module declares.`
        );
      }
    } catch (error) {
      fail(`${manifest.id}: ${error.message}`);
    }
  }
}

// --- 6. Menu permissions ------------------------------------------------------
function checkMenu(moduleId, nodes) {
  for (const node of nodes || []) {
    if (node.permission && !declared.has(node.permission.resource)) {
      fail(
        `${moduleId}: menu item "${node.id}" references permission resource ` +
          `"${node.permission.resource}", which no module declares.`
      );
    }
    if (node.children) checkMenu(moduleId, node.children);
  }
}
for (const manifest of manifests) checkMenu(manifest.id, manifest.menu);

// --- 7. requirePermission resources exist ------------------------------------
// A source scan rather than a runtime check, so it also covers routes that a
// given configuration would not mount.
const ROUTE_RESOURCE_PATTERN = /requirePermission\(\s*(?:\[([^\]]*)\]|['"]([^'"]+)['"])/g;

function scanDirectory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(full);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      scanFile(full);
    }
  }
}

function scanFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(process.cwd(), file);

  let match;
  while ((match = ROUTE_RESOURCE_PATTERN.exec(source)) !== null) {
    const resources = match[1]
      ? match[1].split(',').map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      : [match[2]];

    for (const resource of resources) {
      if (!resource || resource.includes('RESOURCE') || resource.startsWith('$')) continue;
      if (!declared.has(resource)) {
        fail(`${relative}: guards "${resource}", which no module declares.`);
      }
    }
  }

  // Unwrapped async handlers hang the request instead of erroring.
  const unwrapped = source.match(/router\.(get|post|put|patch|delete)\([^)]*,\s*async\s*\(/g);
  if (unwrapped) {
    warn(`${relative}: ${unwrapped.length} async handler(s) may not be wrapped in asyncHandler.`);
  }
}

const modulesDir = path.join(__dirname, '..', 'server', 'modules');
if (fs.existsSync(modulesDir)) scanDirectory(modulesDir);

// --- 8. Boot hooks stay inside the seed stub's surface ------------------------
//
// `scripts/seed.js` boots every module without an HTTP server and hands each
// `onBoot` a stand-in for the Express app. A hook that calls something the
// stand-in does not provide fails the seed, and only the seed - which is why
// this class of break survives every other check here and shows up later, in
// somebody's first `make seed`.
//
// The permitted surface is read out of `createSeedAppStub` rather than
// restated here. One definition, and the check follows it: widen the stub and
// this check widens with it, in the same commit, by construction.

const SEED_SCRIPT = path.join(__dirname, 'seed.js');
const STUB_FACTORY = 'createSeedAppStub';

// Both helpers preserve length, so an index found in a blanked copy still
// points at the same place in every other copy, and in the original.
const blot = (match) => ' '.repeat(match.length);

/** Blanks comments. Prose about `app.listen` must not read as a call to it. */
function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, blot).replace(/\/\/[^\n]*/g, blot);
}

/**
 * Blanks comments and string literals, so brace and paren matching cannot be
 * thrown off by a `}` inside either.
 */
function blankNoise(source) {
  return blankComments(source).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, blot);
}

/** Returns the balanced `{...}` body that follows a parameter list at `from`. */
function bodyAfterParams(blank, from) {
  const paren = blank.indexOf('(', from);
  if (paren === -1) return null;

  let depth = 0;
  let i = paren;
  for (; i < blank.length; i += 1) {
    if (blank[i] === '(') depth += 1;
    else if (blank[i] === ')' && (depth -= 1) === 0) break;
  }
  if (i >= blank.length) return null;

  return balancedBlock(blank, blank.indexOf('{', i));
}

/** Returns `[start, end]` of the balanced block opening at `open`, or null. */
function balancedBlock(blank, open) {
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < blank.length; i += 1) {
    if (blank[i] === '{') depth += 1;
    else if (blank[i] === '}' && (depth -= 1) === 0) return [open + 1, i];
  }
  return null;
}

/** Member names a hook body reads off `app`, e.g. `app.use(...)` -> `use`. */
function appMembersIn(text) {
  const members = new Set();
  const pattern = /\bapp\s*\.\s*([A-Za-z_$][\w$]*)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) members.add(match[1]);
  return members;
}

/** The surface `createSeedAppStub` actually offers, read from its source. */
function readSeedStubSurface() {
  if (!fs.existsSync(SEED_SCRIPT)) return null;

  const source = fs.readFileSync(SEED_SCRIPT, 'utf8');
  const blank = blankNoise(source);

  // The declaration, not a call site: `createSeedAppStub()` appears where the
  // stub is handed to a hook too, and reading the surface out of that would
  // capture whatever block happened to follow.
  const declaration = new RegExp(`function\\s+${STUB_FACTORY}\\s*\\(`).exec(blank);
  if (!declaration) return null;

  const range = bodyAfterParams(blank, declaration.index);
  if (!range) return null;

  // `set() {}` and `locals: {}` - a method definition or a property key. Read
  // from the comment-blanked copy: a word in prose is not part of the surface.
  const surface = new Set();
  const pattern = /([A-Za-z_$][\w$]*)\s*(?:\(\s*\)\s*\{|:)/g;
  let match;
  while ((match = pattern.exec(blankComments(source).slice(range[0], range[1]))) !== null) {
    surface.add(match[1]);
  }
  return surface;
}

const seedSurface = readSeedStubSurface();

if (!seedSurface || !seedSurface.size) {
  // Not a silent skip: a check that cannot read its own reference is a check
  // that has stopped working, and that is worth failing over.
  fail(
    `Could not read the app surface from ${STUB_FACTORY}() in scripts/seed.js. ` +
      'Boot hooks cannot be verified until it is readable again.'
  );
} else {
  for (const dir of dirs) {
    const manifestFile = path.join(dir, 'module.manifest.js');
    if (!fs.existsSync(manifestFile)) continue;

    const source = fs.readFileSync(manifestFile, 'utf8');
    const blank = blankNoise(source);
    const relative = path.relative(process.cwd(), manifestFile);

    const at = blank.search(/\bonBoot\b/);
    if (at === -1) continue;

    const range = bodyAfterParams(blank, at);
    if (!range) {
      warn(`${relative}: found onBoot but could not read its body; skipped.`);
      continue;
    }

    for (const member of appMembersIn(blank.slice(range[0], range[1]))) {
      if (seedSurface.has(member)) continue;
      fail(
        `${relative}: onBoot calls app.${member}(), which ${STUB_FACTORY}() in ` +
          `scripts/seed.js does not provide, so \`npm run seed\` will throw. ` +
          `Add ${member} to the stub, or move the call to onReady.`
      );
    }
  }
}

// --- Report -------------------------------------------------------------------
/* eslint-disable no-console */
console.log('');
console.log(`Modules discovered : ${manifests.length}  [${manifests.map((m) => m.id).join(', ')}]`);
console.log(`Permissions        : ${declared.size}`);
console.log(`Settings           : ${settingKeys.size}`);
if (seedSurface && seedSurface.size) {
  console.log(`Seed app surface   : ${[...seedSurface].sort().join(', ')}`);
}
console.log('');

for (const warning of warnings) console.log(`  WARN  ${warning}`);
for (const problem of problems) console.log(`  FAIL  ${problem}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s) found.\n`);
  process.exit(1);
}

console.log(`Module contracts verified${warnings.length ? ` (${warnings.length} warning(s))` : ''}.\n`);
process.exit(0);
