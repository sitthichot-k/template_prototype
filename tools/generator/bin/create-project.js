#!/usr/bin/env node
'use strict';

/**
 * Child-project generator.
 *
 *   node tools/generator/bin/create-project.js \
 *     --project-code hrms \
 *     --project-name "HR Management System" \
 *     --out ../hrms
 *
 *   node tools/generator/bin/create-project.js --dry-run --project-code smoke --project-name Smoke
 *
 * Dependency-free by design: it has to run immediately after a clone, before
 * anyone has installed anything.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const tokens = require('../src/tokens');
const { generate, FRONTEND_DIR } = require('../src/generate');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', '..');

// --- Argument parsing --------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--yes' || token === '-y') {
      args.yes = true;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token.startsWith('--')) {
      // --project-code -> projectCode
      const key = token.slice(2).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args._.push(token);
    }
  }

  return args;
}

function usage() {
  return `
Generate a child project from the enterprise platform template.

  node tools/generator/bin/create-project.js [options]

Required
  --project-code <slug>     Lowercase slug: database name, image name, permission root.
  --project-name <name>     Human-readable display name.

Optional
  --out <dir>               Output directory (default: ../<project-code>)
  --description <text>
  --version <semver>        (default: 1.0.0)
  --org <name>              Organisation name         (default: Acme)
  --primary-color <hex>     (default: #2563eb)
  --locale <th|en>          (default: th)
  --domain <host>           Production hostname, e.g. hrms.example.com. Fills
                            CORS_ORIGINS and COOKIE_DOMAIN for preproduction
                            (preprod.<host>) and production. Left as CHANGE_ME
                            when omitted.
  --registry <host>         Container registry for the deploy tiers.
                            Left as CHANGE_ME when omitted.
  --dry-run                 Report what would happen, write nothing.
  --yes, -y                 Skip the confirmation prompt.

Example
  node tools/generator/bin/create-project.js \\
    --project-code hrms --project-name "HR Management System" \\
    --domain hrms.example.com \\
    --registry registry.example.com --out ../hrms
`;
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// --- Main --------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (message = '') => console.log(message); // eslint-disable-line no-console

  if (args.help) {
    log(usage());
    return 0;
  }

  // `--frontend` was removed with the React shell (ADR 0007). Accepting it
  // silently would let a script that still passes `--frontend react` appear to
  // succeed while producing a Vue project.
  if (args.frontend && args.frontend !== 'vue') {
    log(`\n--frontend "${args.frontend}" is no longer supported: the platform ships one frontend (Vue).`);
    log('See docs/adr/0007-single-frontend-flavour.md.\n');
    return 2;
  }

  const { values, errors } = tokens.resolve({
    PROJECT_CODE: args.projectCode,
    PROJECT_NAME: args.projectName,
    PROJECT_DESCRIPTION: args.description,
    PROJECT_VERSION: args.version,
    ORG_NAME: args.org,
    PRIMARY_COLOR: args.primaryColor,
    DEFAULT_LOCALE: args.locale
  });

  if (errors.length) {
    log('\nCannot generate:\n');
    for (const error of errors) log(`  - ${error}`);
    log(`\n${usage()}`);
    return 2;
  }

  const outputDir = path.resolve(args.out || path.join(TEMPLATE_ROOT, '..', values.PROJECT_CODE));

  // Generating into the template itself would overwrite the source of truth.
  if (outputDir === TEMPLATE_ROOT || outputDir.startsWith(`${TEMPLATE_ROOT}${path.sep}`)) {
    log(`\nRefusing to generate inside the template directory (${outputDir}).\n`);
    return 2;
  }

  log('');
  log('  Enterprise platform template - project generator');
  log('  ' + '-'.repeat(58));
  log(`  Code        ${values.PROJECT_CODE}`);
  log(`  Name        ${values.PROJECT_NAME}`);
  log(`  Version     ${values.PROJECT_VERSION}`);
  log(`  Frontend    ${FRONTEND_DIR}`);
  log(`  Locale      ${values.DEFAULT_LOCALE}`);
  log(`  Domain      ${args.domain || 'CHANGE_ME (set --domain to fill it in)'}`);
  log(`  Registry    ${args.registry || 'CHANGE_ME (set --registry to fill it in)'}`);
  log(`  Output      ${outputDir}`);
  log('  ' + '-'.repeat(58));
  log('');

  if (args.dryRun) log('  DRY RUN - nothing will be written.\n');

  if (!args.dryRun && !args.yes && process.stdin.isTTY) {
    if (!(await confirm('  Generate this project?'))) {
      log('\n  Cancelled.\n');
      return 1;
    }
    log('');
  }

  let report;
  try {
    report = await generate({
      templateRoot: TEMPLATE_ROOT,
      outputDir,
      values,
      domain: args.domain,
      registry: args.registry,
      dryRun: Boolean(args.dryRun),
      log
    });
  } catch (error) {
    log(`\n  Generation failed: ${error.message}\n`);
    return 1;
  }

  log('');
  log(`  Directories  ${report.directoriesCreated}`);
  log(`  Files        ${report.filesCopied} (${report.filesTokenised} contained tokens)`);
  log(`  Excluded     ${report.skipped.length} path(s) via .templateignore`);
  log(`  Stripped     ${report.filesStripped} file(s) contained template-only regions`);

  if (args.dryRun) {
    log('\n  Dry run complete. Re-run without --dry-run to write the project.\n');
    return 0;
  }

  log(`  Env files    ${report.envFiles || 0} written across the three tiers`);
  log(`  Secrets      ${report.secrets.length} generated for the local tier`);
  for (const item of report.narrative || []) log(`  Rewritten    ${item}`);
  log('');
  log('  Next steps');
  log('  ' + '-'.repeat(58));
  log(`  cd ${path.relative(process.cwd(), outputDir) || outputDir}`);
  log('  git init && git add -A && git commit -m "Initial commit from platform template"');
  log('  make up                # or: ./scripts/compose.sh local up -d --build');
  log('  make seed              # creates system roles and the bootstrap admin');
  log('');
  log('  The bootstrap administrator password is printed once by the seed run.');
  log('  Preproduction and production env files still contain CHANGE_ME markers -');
  log('  resolve them from your secret manager before deploying those tiers.');
  log('');

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
