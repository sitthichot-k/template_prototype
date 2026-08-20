'use strict';

/**
 * Token definition and substitution.
 *
 * Tokens use `__NAME__` because that form survives every file type the
 * template contains - JSON, YAML, JS, Vue SFCs, Dockerfiles, .env - without
 * needing an escape or a templating engine. A generated project is therefore
 * the same files with different strings in them, which keeps `git diff`
 * against the template readable when it comes time to pull in an upgrade.
 */

const crypto = require('crypto');

const TOKEN_PATTERN = /__([A-Z][A-Z0-9_]*)__/g;

/** Files that are copied verbatim - substituting inside them would corrupt them. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.gz', '.tar', '.7z',
  '.mp3', '.mp4', '.webm'
]);

const DEFINITIONS = [
  {
    name: 'PROJECT_CODE',
    required: true,
    prompt: 'Project code (lowercase slug)',
    validate(value) {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(value)) {
        return 'must be lowercase, start with a letter, and contain only letters, digits and hyphens';
      }
      // These become a Mongo database name and a Docker image name.
      if (value.endsWith('-')) return 'must not end with a hyphen';
      return null;
    }
  },
  {
    name: 'PROJECT_NAME',
    required: true,
    prompt: 'Display name',
    validate: (value) => (value.trim().length ? null : 'must not be empty')
  },
  {
    name: 'PROJECT_DESCRIPTION',
    required: false,
    default: (values) => `${values.PROJECT_NAME} - generated from the enterprise platform template.`
  },
  { name: 'PROJECT_VERSION', required: false, default: () => '1.0.0' },
  { name: 'ORG_NAME', required: false, default: () => 'Acme' },
  {
    name: 'PRIMARY_COLOR',
    required: false,
    default: () => '#2563eb',
    validate: (value) => (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? null : 'must be a hex colour, e.g. #2563eb')
  },
  {
    name: 'DEFAULT_LOCALE',
    required: false,
    default: () => 'th',
    validate: (value) => (['th', 'en'].includes(value) ? null : "must be 'th' or 'en'")
  }
];

/**
 * Fills in defaults and validates. Returns `{ values, errors }` rather than
 * throwing, so the CLI can report every problem at once instead of one per
 * run.
 */
function resolve(input) {
  const values = {};
  const errors = [];

  for (const definition of DEFINITIONS) {
    let value = input[definition.name];

    if ((value === undefined || value === '') && definition.default) {
      value = definition.default(values);
    }

    if ((value === undefined || value === '') && definition.required) {
      errors.push(`${definition.name} is required.`);
      continue;
    }

    if (value !== undefined && value !== '' && definition.validate) {
      const problem = definition.validate(String(value));
      if (problem) errors.push(`${definition.name} ${problem}.`);
    }

    values[definition.name] = value === undefined ? '' : String(value);
  }

  return { values, errors };
}

/**
 * Replaces every `__TOKEN__` occurrence.
 *
 * An unknown token is left in place rather than blanked: a silent empty
 * string in a config file is far harder to notice than a literal
 * `__SOMETHING__` that fails loudly on first use.
 */
function substitute(content, values) {
  return content.replace(TOKEN_PATTERN, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
  );
}

/**
 * Marker lines delimiting a region that belongs to the template only.
 *
 * Some files have to serve two audiences: the `Makefile` is the template
 * author's entry point *and* the child project's, and only one of them has a
 * generator to invoke. Maintaining two copies of such a file guarantees they
 * drift, so instead a single file marks the parts that must not travel:
 *
 *   # >>> template-only
 *   new: ## Generate a child project
 *   	node tools/generator/bin/create-project.js ...
 *   # <<< template-only
 *
 * The marker is matched anywhere on the line, so the surrounding comment
 * syntax can be `#`, `//`, `<!-- -->` or anything else the file needs.
 */
const TEMPLATE_ONLY_OPEN = /^.*>>>\s*template-only.*$/;
const TEMPLATE_ONLY_CLOSE = /^.*<<<\s*template-only.*$/;

/**
 * Removes every template-only region, and any blank line left dangling
 * directly above one, so the child's file does not gain a stray gap where the
 * region used to be.
 *
 * An unterminated region throws rather than silently truncating the rest of
 * the file: a `Makefile` that quietly lost half its targets would be found
 * much later than a generation that refused to run.
 */
function stripTemplateOnly(content, relativePath) {
  if (!content.includes('template-only')) return content;

  const lines = content.split(/\r?\n/);
  const kept = [];
  let stripping = false;
  let openedAt = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!stripping && TEMPLATE_ONLY_OPEN.test(line)) {
      stripping = true;
      openedAt = i + 1;
      while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
      continue;
    }

    if (stripping) {
      if (TEMPLATE_ONLY_CLOSE.test(line)) stripping = false;
      continue;
    }

    kept.push(line);
  }

  if (stripping) {
    throw new Error(
      `Unterminated "template-only" region opened at ${relativePath}:${openedAt} — add a matching "<<< template-only" marker.`
    );
  }

  return kept.join('\n');
}

function isBinary(filePath) {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/**
 * Identifiers that look like tokens but are not generator inputs - build-time
 * defines and the like. Reporting these as unresolved would train the reader
 * to ignore the warning, which is exactly what the warning must not become.
 */
const NON_TOKENS = new Set(['APP_VERSION', 'dirname', 'filename']);

/** Lists tokens present in a string that `values` does not define. */
function findUnresolved(content, values) {
  const unresolved = new Set();
  let match;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(content)) !== null) {
    const name = match[1];
    if (NON_TOKENS.has(name)) continue;
    if (!Object.prototype.hasOwnProperty.call(values, name)) unresolved.add(name);
  }
  return Array.from(unresolved);
}

/**
 * Cryptographically random secret for a generated `.env.local`.
 *
 * base64url so the value is safe unquoted in an env file, a URL and a shell
 * argument - `+`, `/` and `=` all cause trouble in at least one of those.
 */
function generateSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url').slice(0, Math.ceil((bytes * 4) / 3));
}

/** A password that satisfies the default policy: length, case, digit, symbol. */
function generatePassword() {
  const base = crypto.randomBytes(18).toString('base64url').replace(/[-_]/g, '');
  return `${base}Aa1!`;
}

module.exports = {
  DEFINITIONS,
  TOKEN_PATTERN,
  NON_TOKENS,
  resolve,
  substitute,
  stripTemplateOnly,
  isBinary,
  findUnresolved,
  generateSecret,
  generatePassword
};
