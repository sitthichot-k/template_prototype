'use strict';

/**
 * The generation pipeline.
 *
 * Each phase is a separate function so `--dry-run` can report exactly what
 * would happen, and so a failure names the phase it happened in rather than
 * leaving a half-written project behind.
 */

const fs = require('fs');
const path = require('path');

const tokens = require('./tokens');
const ignore = require('./ignore');

const ENV_TIERS = ['local', 'preproduction', 'production'];

/**
 * The single frontend the platform ships.
 *
 * It was `vue | react | both` until ADR 0007 retired the React shell. Adding a
 * second flavour back means reintroducing a selection flag here, in the CLI,
 * and in `copyTree` - see the ADR for why that cost was judged not worth
 * paying for a shell nobody was building against.
 */
const FRONTEND_DIR = 'frontend-vue';

/**
 * @param {object} options
 * @param {string} options.templateRoot
 * @param {string} options.outputDir
 * @param {object} options.values          Resolved token values.
 * @param {boolean} options.dryRun
 * @param {(message: string) => void} options.log
 */
async function generate(options) {
  const { templateRoot, outputDir, values, domain, registry, dryRun, log } = options;

  const report = {
    filesCopied: 0,
    filesTokenised: 0,
    filesStripped: 0,
    directoriesCreated: 0,
    skipped: [],
    secrets: [],
    unresolved: new Map()
  };

  // --- Phase 1: validate the destination ------------------------------------
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
    throw new Error(`Output directory "${outputDir}" exists and is not empty.`);
  }

  const rules = ignore.load(templateRoot);

  // --- Phase 2: copy the tree, substituting tokens as it goes ---------------
  copyTree({ templateRoot, outputDir, rules, values, dryRun, report });

  // --- Phase 3: render env files with freshly generated local secrets -------
  renderEnvFiles({ templateRoot, outputDir, values, domain, registry, dryRun, report });

  // --- Phase 4: give the frontend its nginx build context -------------------
  if (!dryRun) {
    retargetFrontend({ outputDir });
  }

  // --- Phase 5: replace the template's narrative with the child's own -------
  if (!dryRun) {
    renderChildNarrative({ templateRoot, outputDir, values, report });
  }

  // --- Phase 6: record where the project came from --------------------------
  if (!dryRun) {
    writeChildManifest({ templateRoot, outputDir, values });
  }

  if (report.unresolved.size) {
    log('');
    log('  Unresolved tokens were left in place (they are not generator inputs):');
    for (const [token, files] of report.unresolved) {
      log(`    __${token}__  in ${files.length} file(s), e.g. ${files[0]}`);
    }
  }

  return report;
}

function copyTree({ templateRoot, outputDir, rules, values, dryRun, report }) {
  walk(templateRoot);

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolute = path.join(currentDir, entry.name);
      const relative = path.relative(templateRoot, absolute).split(path.sep).join('/');

      if (ignore.isIgnored(rules, relative, entry.isDirectory())) {
        report.skipped.push(relative);
        continue;
      }

      const destination = path.join(outputDir, relative);

      if (entry.isDirectory()) {
        if (!dryRun) fs.mkdirSync(destination, { recursive: true });
        report.directoriesCreated += 1;
        walk(absolute);

        // A directory whose entire contents were excluded (`tools/`, once the
        // generator is filtered out) would otherwise be left behind empty.
        if (!dryRun && fs.readdirSync(destination).length === 0) {
          fs.rmdirSync(destination);
          report.directoriesCreated -= 1;
        }
        continue;
      }

      copyFile({ absolute, destination, relative, values, dryRun, report });
    }
  }
}

function copyFile({ absolute, destination, relative, values, dryRun, report }) {
  report.filesCopied += 1;

  if (tokens.isBinary(absolute)) {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(absolute, destination);
    }
    return;
  }

  const source = fs.readFileSync(absolute, 'utf8');
  const stripped = tokens.stripTemplateOnly(source, relative);
  const rendered = tokens.substitute(stripped, values);

  if (stripped !== source) report.filesStripped += 1;
  if (rendered !== stripped) report.filesTokenised += 1;

  for (const token of tokens.findUnresolved(rendered, values)) {
    if (!report.unresolved.has(token)) report.unresolved.set(token, []);
    report.unresolved.get(token).push(relative);
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, rendered, 'utf8');
  }
}

/**
 * Rewrites the env files.
 *
 * The local tier gets real, randomly generated secrets so `make up` works
 * immediately. The other two keep CHANGE_ME placeholders on purpose: a
 * generated secret that nobody rotated is worse than an obvious blank,
 * because it looks like it was handled.
 */
function renderEnvFiles({ templateRoot, outputDir, values, domain, registry, dryRun, report }) {
  // There is no JWT_REFRESH_SECRET here on purpose. Refresh tokens are opaque
  // random bytes stored as a hash against a session document rather than
  // signed JWTs, so no second signing secret exists to generate - see the note
  // in backend-node/config/index.js. Generating one produced a value that no
  // env file declared and nothing ever read.
  const localSecrets = {
    JWT_ACCESS_SECRET: tokens.generateSecret(48),
    ENCRYPTION_KEY: tokens.generateSecret(32),
    COOKIE_SECRET: tokens.generateSecret(24),
    MONGO_ROOT_PASSWORD: tokens.generateSecret(24),
    MONGO_APP_PASSWORD: tokens.generateSecret(24),
    REDIS_PASSWORD: tokens.generateSecret(24)
  };

  report.secrets = Object.keys(localSecrets);

  const code = values.PROJECT_CODE;
  const frontendDir = FRONTEND_DIR;

  // Anything site-specific that the caller did not supply becomes CHANGE_ME
  // rather than a plausible-looking default. `scripts/compose.sh` then refuses
  // to deploy the tier until it is resolved. A wrong-but-valid value here -
  // a localhost CORS origin in production, say - would pass every check and
  // fail only in the way that matters.
  const PLACEHOLDER = 'CHANGE_ME';
  const preprodHost = domain ? `preprod.${domain}` : PLACEHOLDER;
  const prodHost = domain || PLACEHOLDER;
  const registryValue = registry || PLACEHOLDER;

  const rootReplacements = {
    local: {
      PROJECT_CODE: code,
      PROJECT_NAME: values.PROJECT_NAME,
      PROJECT_DESCRIPTION: values.PROJECT_DESCRIPTION,
      COMPOSE_PROJECT_NAME: `${code}-local`,
      MONGO_DATABASE: `${code}_local`,
      MONGO_ROOT_USERNAME: 'root',
      MONGO_ROOT_PASSWORD: localSecrets.MONGO_ROOT_PASSWORD,
      MONGO_APP_USERNAME: `${code}_app`,
      MONGO_APP_PASSWORD: localSecrets.MONGO_APP_PASSWORD,
      REDIS_PASSWORD: localSecrets.REDIS_PASSWORD,
      BACKEND_ENV_FILE: './backend-node/.env.local',
      FRONTEND_ENV_FILE: `./${frontendDir}/.env.local`,
      FRONTEND_CONTEXT: `./${frontendDir}`,
      REGISTRY: registry || 'local',
      IMAGE_NAMESPACE: code
    },
    preproduction: {
      PROJECT_CODE: code,
      PROJECT_NAME: values.PROJECT_NAME,
      PROJECT_DESCRIPTION: values.PROJECT_DESCRIPTION,
      COMPOSE_PROJECT_NAME: `${code}-preprod`,
      MONGO_DATABASE: `${code}_preprod`,
      BACKEND_ENV_FILE: './backend-node/.env.preproduction',
      FRONTEND_ENV_FILE: `./${frontendDir}/.env.preproduction`,
      FRONTEND_CONTEXT: `./${frontendDir}`,
      REGISTRY: registryValue,
      IMAGE_NAMESPACE: code
    },
    production: {
      PROJECT_CODE: code,
      PROJECT_NAME: values.PROJECT_NAME,
      PROJECT_DESCRIPTION: values.PROJECT_DESCRIPTION,
      COMPOSE_PROJECT_NAME: `${code}-prod`,
      MONGO_DATABASE: code,
      BACKEND_ENV_FILE: './backend-node/.env.production',
      FRONTEND_ENV_FILE: `./${frontendDir}/.env.production`,
      FRONTEND_CONTEXT: `./${frontendDir}`,
      REGISTRY: registryValue,
      IMAGE_NAMESPACE: code
    }
  };

  const backendReplacements = {
    local: Object.assign(
      {
        PROJECT_CODE: code,
        PROJECT_NAME: values.PROJECT_NAME,
        PROJECT_DESCRIPTION: values.PROJECT_DESCRIPTION,
        PROJECT_ORGANIZATION: values.ORG_NAME,
        BRANDING_PRIMARY_COLOR: values.PRIMARY_COLOR,
        DEFAULT_LOCALE: values.DEFAULT_LOCALE,
        JWT_ISSUER: code,
        JWT_AUDIENCE: `${code}-api`,
        REDIS_KEY_PREFIX: `${code}:`,
        MONGO_URI: `mongodb://${code}_app:${localSecrets.MONGO_APP_PASSWORD}@127.0.0.1:27017/${code}_local?authSource=${code}_local`,
        REDIS_URL: `redis://:${localSecrets.REDIS_PASSWORD}@127.0.0.1:6379`
      },
      localSecrets
    ),
    preproduction: {
      PROJECT_CODE: code,
      PROJECT_NAME: values.PROJECT_NAME,
      PROJECT_DESCRIPTION: values.PROJECT_DESCRIPTION,
      JWT_ISSUER: code,
      JWT_AUDIENCE: `${code}-api`,
      REDIS_KEY_PREFIX: `${code}:preprod:`,
      PROJECT_ORGANIZATION: values.ORG_NAME,
      BRANDING_PRIMARY_COLOR: values.PRIMARY_COLOR,
      DEFAULT_LOCALE: values.DEFAULT_LOCALE,
      CORS_ORIGINS: domain ? `https://${preprodHost}` : PLACEHOLDER,
      COOKIE_DOMAIN: preprodHost,
      BOOTSTRAP_ADMIN_EMAIL: PLACEHOLDER
    },
    production: {
      PROJECT_CODE: code,
      PROJECT_NAME: values.PROJECT_NAME,
      PROJECT_DESCRIPTION: values.PROJECT_DESCRIPTION,
      JWT_ISSUER: code,
      JWT_AUDIENCE: `${code}-api`,
      REDIS_KEY_PREFIX: `${code}:prod:`,
      PROJECT_ORGANIZATION: values.ORG_NAME,
      BRANDING_PRIMARY_COLOR: values.PRIMARY_COLOR,
      DEFAULT_LOCALE: values.DEFAULT_LOCALE,
      CORS_ORIGINS: domain ? `https://${prodHost}` : PLACEHOLDER,
      COOKIE_DOMAIN: prodHost,
      BOOTSTRAP_ADMIN_EMAIL: PLACEHOLDER
    }
  };

  /**
   * Each tier is rendered from the TEMPLATE's own `.env.<tier>` file, not from
   * `.env.example`.
   *
   * This matters more than it looks. The tier files carry the hardening that
   * distinguishes the tiers - `SWAGGER_ENABLED=false`, `COOKIE_SECURE=true`,
   * `SameSite=strict`, `LOG_LEVEL=warn`, shorter token TTLs. Rendering
   * production from the local-shaped example silently produced a child project
   * whose "production" env was a development config, which every check would
   * have passed.
   *
   * The template's tier files are excluded from the file copy (they hold the
   * template author's own local secrets), so they are read from templateRoot
   * here and every secret-bearing key is overwritten below.
   */
  for (const tier of ENV_TIERS) {
    materialiseEnv({
      source: path.join(templateRoot, `.env.${tier}`),
      fallback: path.join(outputDir, '.env.example'),
      target: path.join(outputDir, `.env.${tier}`),
      replacements: rootReplacements[tier],
      tier,
      dryRun,
      report
    });

    materialiseEnv({
      source: path.join(templateRoot, 'backend-node', `.env.${tier}`),
      fallback: path.join(outputDir, 'backend-node', '.env.example'),
      target: path.join(outputDir, 'backend-node', `.env.${tier}`),
      replacements: backendReplacements[tier],
      tier,
      dryRun,
      report
    });

    const frontendFallback = path.join(outputDir, FRONTEND_DIR, '.env.example');
    if (fs.existsSync(frontendFallback) || dryRun) {
      materialiseEnv({
        source: path.join(templateRoot, FRONTEND_DIR, `.env.${tier}`),
        fallback: frontendFallback,
        target: path.join(outputDir, FRONTEND_DIR, `.env.${tier}`),
        replacements: { VITE_APP_NAME: values.PROJECT_NAME, VITE_DEFAULT_LOCALE: values.DEFAULT_LOCALE },
        tier,
        dryRun,
        report
      });
    }
  }
}

/**
 * Creates one tier's env file and applies the tier's values.
 *
 * `KEY=value` lines are rewritten in place so comments, grouping and ordering
 * survive - an env file people are expected to read and edit is worth keeping
 * legible.
 *
 * @param {string} params.source    The template's tier file: carries the tier's shape.
 * @param {string} params.fallback  `.env.example`, used only if the tier file is absent.
 */
function materialiseEnv({ source, fallback, target, replacements, tier, dryRun, report }) {
  if (dryRun) {
    report.envFiles = (report.envFiles || 0) + 1;
    return;
  }

  const origin = fs.existsSync(source) ? source : fallback;
  if (!origin || !fs.existsSync(origin)) return;

  const lines = fs.readFileSync(origin, 'utf8').split(/\r?\n/);

  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match) return line;

    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      return `${key}=${replacements[key]}`;
    }

    // Anything not supplied for this tier keeps the tier file's value - which
    // for preproduction and production is CHANGE_ME. That is the point:
    // ./scripts/compose.sh refuses to deploy those tiers until each one has
    // been resolved from the secret manager.
    return line;
  });

  const banner =
    `# Generated for the "${tier}" tier by the platform template generator.\n` +
    (tier === 'local'
      ? '# Secrets below are randomly generated DEVELOPMENT values. Never reuse them elsewhere.\n'
      : '# Every CHANGE_ME must be resolved from the secret manager before deploying.\n');

  fs.writeFileSync(target, banner + updated.join('\n'), 'utf8');
  report.envFiles = (report.envFiles || 0) + 1;
}

/**
 * Copies the canonical nginx config into the frontend's build context, since
 * Docker cannot COPY from outside one.
 */
function retargetFrontend({ outputDir }) {
  const source = path.join(outputDir, 'infra', 'nginx', 'default.conf');
  if (!fs.existsSync(source)) return;

  const target = path.join(outputDir, FRONTEND_DIR, 'nginx');
  if (!fs.existsSync(path.join(outputDir, FRONTEND_DIR))) return;

  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(source, path.join(target, 'default.conf'));
}

/**
 * Replaces the material that describes the *template* with material that
 * describes the *child*.
 *
 * The template's own README is written for someone generating projects: it is
 * titled after the template and its first instruction is to run the generator,
 * which a child does not have. Shipping it meant every generated project
 * opened with a page about a different piece of software.
 *
 * The ADRs are kept, because "why CommonJS?" is a question the child's
 * developers will ask too - but moved under `inherited/`, so that a record
 * saying "we decided" is not mistaken for a decision this team made, and so
 * the child's own series can start at 0001.
 */
function renderChildNarrative({ templateRoot, outputDir, values, report }) {
  const narrativeValues = Object.assign({}, values, { FRONTEND_DIR: FRONTEND_DIR });

  const readmeSource = path.join(templateRoot, 'tools', 'generator', 'templates', 'README.md');
  if (fs.existsSync(readmeSource)) {
    const rendered = tokens.substitute(fs.readFileSync(readmeSource, 'utf8'), narrativeValues);
    fs.writeFileSync(path.join(outputDir, 'README.md'), rendered, 'utf8');
    report.narrative = (report.narrative || []).concat('README.md');
  }

  relocateInheritedAdrs({ outputDir, values, report });
}

/**
 * Moves the template's decision records into `docs/adr/inherited/` and leaves
 * an index in their place for the child's own.
 *
 * The records keep their filenames and their relative links to each other, so
 * moving the whole folder does not break any of them.
 */
function relocateInheritedAdrs({ outputDir, values, report }) {
  const adrDir = path.join(outputDir, 'docs', 'adr');
  if (!fs.existsSync(adrDir)) return;

  const inheritedDir = path.join(adrDir, 'inherited');
  const records = fs
    .readdirSync(adrDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'));

  if (!records.length) return;

  fs.mkdirSync(inheritedDir, { recursive: true });
  for (const record of records) {
    fs.renameSync(path.join(adrDir, record.name), path.join(inheritedDir, record.name));
  }

  fs.writeFileSync(
    path.join(adrDir, 'README.md'),
    `# Architecture decision records\n\n` +
      `Short records of decisions that were not obvious, written so a future reader\n` +
      `can tell whether the reasoning still holds. Each states the forces at the time,\n` +
      `not just the outcome.\n\n` +
      `No decisions have been recorded for ${values.PROJECT_NAME} yet. The first one is\n` +
      `\`0001-<slug>.md\`.\n\n` +
      `## Inherited records\n\n` +
      `[inherited/](inherited/) holds the decisions that shaped the platform this\n` +
      `project was generated from. They explain why the core is the way it is, and\n` +
      `they are immutable here - this project did not make them.\n\n` +
      `To depart from one, write a record in **this** folder that supersedes it and\n` +
      `say why the original reasoning does not hold for ${values.PROJECT_NAME}.\n\n` +
      `## Writing a new one\n\n` +
      `Copy the shape of an inherited record: context, decision, consequences,\n` +
      `alternatives considered. Keep it to a page. An ADR that needs a second page is\n` +
      `usually two decisions.\n\n` +
      `Records are immutable once accepted. To change a decision, write a new record\n` +
      `that supersedes it and update the status of the old one - the history is the\n` +
      `point.\n`,
    'utf8'
  );

  const recordCount = records.filter((entry) => /^\d{4}-/.test(entry.name)).length;
  report.narrative = (report.narrative || []).concat(`docs/adr/inherited/ (${recordCount} records)`);
}

/**
 * Records the template version the project came from, so a later upgrade can
 * tell what it is upgrading from.
 */
function writeChildManifest({ templateRoot, outputDir, values }) {
  const templateManifest = JSON.parse(fs.readFileSync(path.join(templateRoot, 'template.manifest.json'), 'utf8'));

  const childManifest = {
    generatedFrom: {
      templateName: templateManifest.templateName,
      templateVersion: templateManifest.templateVersion,
      compatProfile: templateManifest.compatProfile,
      generatedAt: new Date().toISOString()
    },
    project: {
      code: values.PROJECT_CODE,
      name: values.PROJECT_NAME,
      description: values.PROJECT_DESCRIPTION,
      version: values.PROJECT_VERSION,
      organization: values.ORG_NAME
    },
    frontend: FRONTEND_DIR,
    coreModules: templateManifest.coreModules.map((module) => module.id),
    upgrade: {
      note:
        'This project was generated from a template, not forked from it. To take an upgrade, ' +
        'diff against the template at the version above and apply what you want - the module ' +
        'boundaries are designed so platform changes stay out of your feature code.'
    }
  };

  fs.writeFileSync(
    path.join(outputDir, 'project.manifest.json'),
    `${JSON.stringify(childManifest, null, 2)}\n`,
    'utf8'
  );

  // The template's own manifest describes the template, not the child.
  const templateManifestCopy = path.join(outputDir, 'template.manifest.json');
  if (fs.existsSync(templateManifestCopy)) fs.rmSync(templateManifestCopy);
}

module.exports = { generate, ENV_TIERS, FRONTEND_DIR };
