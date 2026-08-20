'use strict';

/**
 * Module scaffolder.
 *
 *   npm run make:module -- inventory --label "Inventory" --resource /operations/inventory
 *
 * Generates a complete, working module folder: manifest, model, repository,
 * service, controller, routes and validators, already wired to the permission
 * and settings systems. The point is that the *correct* way to add a feature
 * is also the fastest one - a developer never has to guess the contract.
 */

const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, '..', 'server', 'modules');

function parseArgs(argv) {
  const args = { id: null, label: null, resource: null, group: null };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  args.id = args.id || positional[0];
  return args;
}

function toPascalCase(value) {
  return String(value)
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toCamelCase(value) {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Validates the permission resource path.
 *
 * Git Bash / MSYS rewrites a leading-slash argument into a Windows path, so
 * `--resource /operations/inventory` can arrive as
 * `C:/Program Files/Git/operations/inventory`. Detecting that here turns a
 * confusing broken manifest into an actionable message.
 */
function normalizeResource(value, id) {
  if (!value) return `/operations/${id}`;

  if (/^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')) {
    // eslint-disable-next-line no-console
    console.error(
      `Resource "${value}" looks like a Windows path.\n` +
        'Git Bash rewrote the leading slash. Re-run with path conversion disabled:\n' +
        `  MSYS_NO_PATHCONV=1 npm run make:module -- ${id} --resource /operations/${id}\n` +
        'or use PowerShell, where this does not happen.'
    );
    process.exit(2);
  }

  if (!/^\/[a-z0-9\-/]*$/.test(value)) {
    // eslint-disable-next-line no-console
    console.error(
      `Resource "${value}" is invalid. It must be a lowercase slash path, e.g. /operations/${id}.`
    );
    process.exit(2);
  }

  return value.replace(/\/+$/, '');
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`  created  ${path.relative(process.cwd(), filePath)}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.id || !/^[a-z][a-z0-9-]*$/.test(args.id)) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: npm run make:module -- <module-id> [--label "Label"] [--resource /path] [--group Group]\n' +
        '       module-id must be lowercase kebab-case, e.g. "inventory" or "purchase-order".'
    );
    process.exit(2);
  }

  const id = args.id;
  const Pascal = toPascalCase(id);
  const camel = toCamelCase(id);
  const label = args.label || Pascal;
  const resource = normalizeResource(args.resource, id);
  const group = args.group || 'Operations';
  const moduleDir = path.join(MODULES_DIR, id);

  if (fs.existsSync(moduleDir)) {
    // eslint-disable-next-line no-console
    console.error(`Module "${id}" already exists at ${moduleDir}.`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`\nScaffolding module "${id}"\n`);

  write(path.join(moduleDir, 'module.manifest.js'), manifestTemplate({ id, Pascal, label, resource, group }));
  write(path.join(moduleDir, 'models', `${id}.model.js`), modelTemplate({ id, Pascal, camel }));
  write(path.join(moduleDir, 'models', 'index.js'), modelIndexTemplate({ id, Pascal }));
  write(path.join(moduleDir, 'services', `${id}.service.js`), serviceTemplate({ id, Pascal, camel }));
  write(path.join(moduleDir, 'controllers', `${id}.controller.js`), controllerTemplate({ id, camel }));
  write(path.join(moduleDir, 'routes', `${id}.routes.js`), routesTemplate({ id, resource }));
  write(path.join(moduleDir, 'validators', 'index.js'), validatorsTemplate({ Pascal }));
  write(path.join(moduleDir, `${id}.test.js`), testTemplate({ id, camel }));

  // eslint-disable-next-line no-console
  console.log(
    `\nModule "${id}" created.\n\n` +
      'Next:\n' +
      '  1. npm run verify:modules   - confirms the manifest and permissions are valid\n' +
      '  2. npm run start:local      - the routes mount automatically, no registration needed\n' +
      `  3. Add the permission to a role, or sign in as SUPER_ADMIN to see ${resource}\n`
  );
}

// --- Templates ---------------------------------------------------------------

function manifestTemplate({ id, label, resource, group }) {
  return `'use strict';

/**
 * ${label} module manifest.
 *
 * Declaring a capability here is all that is required - the kernel discovers
 * this file on boot and registers everything below. There is no central list
 * to edit.
 */

const registerModels = require('./models');

module.exports = {
  id: '${id}',
  name: '${label}',
  version: '1.0.0',
  description: '${label} management.',
  // Feature modules start at 100; core modules occupy 0-99.
  order: 100,
  dependsOn: ['access-control', 'settings'],

  models: registerModels,

  routes: [{ basePath: '/${id}', router: require('./routes/${id}.routes') }],

  permissions: [
    {
      resource: '${resource}',
      label: '${label}',
      description: 'Manage ${label.toLowerCase()} records.',
      group: '${group}',
      actions: ['view', 'create', 'edit', 'delete', 'export']
    }
  ],

  settings: [
    {
      key: '${id.replace(/-([a-z])/g, (m, c) => c.toUpperCase())}.pageSize',
      group: '${id}',
      section: 'general',
      label: 'Default page size',
      type: 'number',
      default: 25,
      min: 10,
      max: 200,
      permission: { resource: '${resource}', action: 'edit' },
      order: 10
    }
  ],

  menu: [
    {
      id: '${id}',
      label: '${label}',
      icon: 'box',
      path: '${resource}',
      permission: { resource: '${resource}', action: 'view' },
      order: 100
    }
  ],

  hooks: {
    async onBoot() {
      // Warm caches or verify external dependencies here.
    }
  }
};
`;
}

function modelTemplate({ id, Pascal, camel }) {
  return `'use strict';

const mongoose = require('mongoose');
const { createSchema } = require('../../../core/db/base-schema');

/**
 * ${Pascal}.
 *
 * createSchema adds timestamps, soft delete, createdBy/updatedBy and a JSON
 * transform that hides internal fields - so this file only declares what is
 * specific to ${camel}.
 */
const schema = createSchema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'draft',
      index: true
    },
    // Extension point for project-specific fields.
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { collection: '${id.replace(/-/g, '')}s' }
);

schema.index({ code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

module.exports = mongoose.models.${Pascal} || mongoose.model('${Pascal}', schema);
`;
}

function modelIndexTemplate({ id, Pascal }) {
  return `'use strict';

module.exports = function registerModels() {
  return { ${Pascal}: require('./${id}.model') };
};
`;
}

function serviceTemplate({ id, Pascal, camel }) {
  return `'use strict';

/**
 * ${Pascal} business logic.
 *
 * Services own the rules and are reachable from routes, jobs, seeds and tests
 * alike. Controllers must stay free of logic so nothing is only testable
 * through HTTP.
 */

const mongoose = require('mongoose');

const AppError = require('../../../core/errors/AppError');
const BaseRepository = require('../../../core/db/base-repository');
const auditService = require('../../../core/audit/audit-service');

let repository = null;

function repo() {
  if (!repository) {
    repository = new BaseRepository(mongoose.model('${Pascal}'), {
      sortable: ['createdAt', 'updatedAt', 'code', 'name', 'status'],
      filterable: ['status'],
      searchable: ['code', 'name', 'description']
    });
  }
  return repository;
}

async function list(query) {
  return repo().list(query);
}

async function getById(id) {
  return repo().findByIdOrFail(id);
}

async function create(payload, { actorId, req } = {}) {
  const Model = mongoose.model('${Pascal}');

  if (await Model.exists({ code: payload.code.toUpperCase(), deletedAt: null })) {
    throw AppError.conflict('A record with this code already exists.', { fields: ['code'] });
  }

  const doc = await repo().create(payload, { actorId });

  await auditService.record({
    action: '${camel}.created',
    category: 'data',
    actorId,
    target: { type: '${id}', id: String(doc._id), label: doc.code },
    req
  });

  return doc;
}

async function update(id, payload, { actorId, req } = {}) {
  const existing = await repo().findByIdOrFail(id);
  const before = existing.toJSON();

  const doc = await repo().updateById(id, payload, { actorId });

  await auditService.recordChange({
    action: '${camel}.updated',
    category: 'data',
    target: { type: '${id}', id: String(doc._id), label: doc.code },
    before,
    after: doc.toJSON(),
    req
  });

  return doc;
}

async function remove(id, { actorId, req } = {}) {
  const existing = await repo().findByIdOrFail(id);
  await repo().deleteById(id, { actorId });

  await auditService.record({
    action: '${camel}.deleted',
    category: 'data',
    actorId,
    target: { type: '${id}', id: String(id), label: existing.code },
    req
  });
}

module.exports = { list, getById, create, update, remove };
`;
}

function controllerTemplate({ id }) {
  return `'use strict';

const asyncHandler = require('../../../core/http/async-handler');
const response = require('../../../core/http/response');
const service = require('../services/${id}.service');

const list = asyncHandler(async (req, res) => {
  const result = await service.list(req.query);
  return response.paginated(res, result.items, result);
});

const getOne = asyncHandler(async (req, res) => {
  return response.ok(res, await service.getById(req.params.id));
});

const create = asyncHandler(async (req, res) => {
  const doc = await service.create(req.body, { actorId: req.auth.userId, req });
  return response.created(res, doc, \`\${req.baseUrl}/\${doc.id}\`);
});

const update = asyncHandler(async (req, res) => {
  return response.ok(res, await service.update(req.params.id, req.body, { actorId: req.auth.userId, req }));
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.params.id, { actorId: req.auth.userId, req });
  return response.noContent(res);
});

module.exports = { list, getOne, create, update, remove };
`;
}

function routesTemplate({ id, resource }) {
  return `'use strict';

const express = require('express');

const validate = require('../../../core/http/validate');
const { authenticate } = require('../../../core/security/authenticate');
const { requirePermission } = require('../../../core/security/authorize');
const controller = require('../controllers/${id}.controller');
const schemas = require('../validators');

const router = express.Router();
const RESOURCE = '${resource}';

router.use(authenticate);

router.get('/', requirePermission(RESOURCE, 'view'), validate({ query: schemas.listQuerySchema }), controller.list);
router.post('/', requirePermission(RESOURCE, 'create'), validate({ body: schemas.createSchema }), controller.create);
router.get('/:id', requirePermission(RESOURCE, 'view'), validate({ params: schemas.idParamSchema }), controller.getOne);
router.patch(
  '/:id',
  requirePermission(RESOURCE, 'edit'),
  validate({ params: schemas.idParamSchema, body: schemas.updateSchema }),
  controller.update
);
router.delete(
  '/:id',
  requirePermission(RESOURCE, 'delete'),
  validate({ params: schemas.idParamSchema }),
  controller.remove
);

module.exports = router;
`;
}

function validatorsTemplate({ Pascal }) {
  return `'use strict';

/**
 * ${Pascal} request schemas.
 *
 * Validation strips unknown keys, so a field absent here can never reach the
 * service - mass assignment is structurally impossible.
 */

const Joi = require('joi');
const { listQuerySchema } = require('../../../core/http/pagination');

const idParamSchema = Joi.object({
  id: Joi.string().hex().length(24).required()
});

const createSchema = Joi.object({
  code: Joi.string().trim().max(40).required(),
  name: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().allow('').max(1000).default(''),
  status: Joi.string().valid('draft', 'active', 'archived').default('draft'),
  attributes: Joi.object().default({})
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).optional(),
  description: Joi.string().allow('').max(1000).optional(),
  status: Joi.string().valid('draft', 'active', 'archived').optional(),
  attributes: Joi.object().optional()
}).min(1);

module.exports = { listQuerySchema, idParamSchema, createSchema, updateSchema };
`;
}

function testTemplate({ id, camel }) {
  return `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const manifest = require('./module.manifest');

test('${id} manifest declares a valid contract', () => {
  assert.equal(manifest.id, '${id}');
  assert.ok(manifest.routes.length > 0, 'module should expose at least one route');
  assert.ok(manifest.permissions.length > 0, 'module should declare at least one permission');

  for (const permission of manifest.permissions) {
    assert.match(permission.resource, /^\\//, 'resource must be a slash path');
    assert.ok(permission.actions.includes('view'), 'every resource needs a view action');
  }
});

test('${camel} menu items reference declared permissions', () => {
  const declared = new Set(manifest.permissions.map((p) => p.resource));

  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.permission) {
        assert.ok(
          declared.has(node.permission.resource),
          \`menu "\${node.id}" references undeclared resource \${node.permission.resource}\`
        );
      }
      walk(node.children);
    }
  };
  walk(manifest.menu);
});
`;
}

main();
