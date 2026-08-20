# Adding a module

A module is the unit of feature work. It is a folder under
`backend-node/server/modules/` containing a `module.manifest.js`, and that file
is its entire contract with the platform.

There is no registration step. The kernel scans the directory on boot, so
adding a folder adds its routes, permissions, settings, menu entries, jobs and
seeds.

---

## Start from the scaffolder

```sh
npm --prefix backend-node run make:module -- inventory \
  --label "Inventory" --resource /operations/inventory --group Operations
```

> On Git Bash, prefix with `MSYS_NO_PATHCONV=1` or the leading slash in
> `--resource` is rewritten into a Windows path. The scaffolder detects this
> and tells you, rather than writing a broken manifest.

That produces a working module: manifest, model, service, controller, routes,
validators and a contract test. Then:

```sh
npm --prefix backend-node run verify:modules
npm --prefix backend-node run start:local
```

The routes are live. Sign in as `SUPER_ADMIN`, or grant the new permission to a
role, and the menu entry appears.

---

## The manifest

```js
module.exports = {
  id: 'inventory',              // lowercase kebab-case, unique
  name: 'Inventory',
  version: '1.0.0',
  order: 100,                   // core modules occupy 0-99
  dependsOn: ['access-control', 'settings'],

  models: registerModels,       // called before anything can query
  routes: [...],
  permissions: [...],
  settings: [...],
  menu: [...],
  jobs: [...],
  seeds: [...],
  hooks: { onBoot, onReady, onShutdown }
};
```

`order` and `dependsOn` together determine boot sequence. A dependency on a
module that is not loaded, or a cycle, fails the boot with a message naming the
chain — it is never resolved arbitrarily.

---

## Permissions

A permission is a **resource path** plus the **actions** valid on it. Keep the
resource aligned with the UI route: one declaration then drives the API guard,
the role editor and the menu visibility check.

```js
permissions: [
  {
    resource: '/operations/inventory',
    label: 'Inventory',
    description: 'Manage stock records.',
    group: 'Operations',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
    dangerous: false            // true adds a warning in the role editor
  }
]
```

Guard a route with it:

```js
router.get('/', requirePermission('/operations/inventory', 'view'), controller.list);
```

**A resource used in `requirePermission` must exist in some manifest.**
`verify-module-contracts` fails the build otherwise, and the access-control
module's `onReady` hook fails the boot. This is deliberate: a typo in a
permission string is otherwise invisible until someone is wrongly locked out,
or wrongly let in.

### Choosing actions

Split an action out when the decision to grant it is genuinely different, not
merely when the operation is different. `assign` is separate from `edit` on
roles because making someone an administrator is a different decision from
renaming a role. `export` is separate from `view` because bulk extraction of
personal data is a different decision from reading one record.

---

## Settings

One descriptor produces validation, storage, encryption, the permission check
and the form control — in both frontends.

```js
settings: [
  {
    key: 'inventory.lowStockThreshold',   // dot-separated camelCase, stable forever
    group: 'inventory',
    section: 'alerts',
    label: 'Low stock threshold',
    description: 'Raise an alert when quantity falls below this.',
    type: 'number',
    default: 10,
    min: 0,
    max: 10000,
    permission: { resource: '/settings/integration', action: 'edit' },
    order: 10
  }
]
```

Read it anywhere:

```js
const settingsService = require('../../core/settings/settings-service');
const threshold = await settingsService.get('inventory.lowStockThreshold');
```

Resolution is `user → organization → global → default`, so a value always
exists even if nobody has visited the settings page.

Useful flags:

| Flag | Effect |
|---|---|
| `secret: true` | AES-256-GCM encrypted at rest; never returned to a client |
| `scopes: ['global', 'user']` | Becomes a per-user preference as well |
| `dependsOn: { key, equals }` | Hidden in the UI until the controlling setting matches |
| `restartRequired: true` | UI warns that the change needs a restart |
| `readOnly: true` | Visible but not editable through the API |

The key is the storage key. Renaming one is a migration, so choose it with the
same care as a column name.

---

## Menu

```js
menu: [
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'box',
    path: '/operations/inventory',
    permission: { resource: '/operations/inventory', action: 'view' },
    order: 100
  }
]
```

The server filters this tree per request and drops containers left empty, so a
section header never appears above nothing. Both frontends render whatever
arrives.

---

## Layering

```
routes/       HTTP shape: method, path, guard, validation schema
controllers/  Translate request → service call → response envelope. No logic.
services/     Business rules. Reachable from jobs, seeds and tests.
models/       Mongoose schemas, built with createSchema()
validators/   Joi schemas - the module's entire input surface, in one file
```

The rule that keeps this honest: **a controller contains no rule that a job or
a seed would also need.** If you find yourself wanting to call a controller
from a script, the logic is in the wrong place.

### Models

Use `createSchema` rather than `new mongoose.Schema` — it applies timestamps,
soft delete, `createdBy`/`updatedBy`, optimistic concurrency and a JSON
transform that strips internals.

```js
const { createSchema } = require('../../../core/db/base-schema');

const schema = createSchema(
  { code: { type: String, required: true }, quantity: { type: Number, default: 0 } },
  { collection: 'inventoryitems' }
);
```

### Services

Extend `BaseRepository` for list endpoints so paging, sorting, filtering and
soft-delete exclusion come for free and behave identically across resources.

```js
repository = new BaseRepository(mongoose.model('InventoryItem'), {
  sortable: ['createdAt', 'code', 'quantity'],
  filterable: ['status'],
  searchable: ['code', 'name']
});
```

`sortable` and `filterable` are allowlists — a caller cannot force a scan on an
unindexed field.

### Controllers

Always wrap async handlers. Express 4 does not await them, so an unwrapped
`throw` hangs the request rather than erroring:

```js
const asyncHandler = require('../../../core/http/async-handler');
const list = asyncHandler(async (req, res) => response.ok(res, await service.list(req.query)));
```

---

## Auditing

Record anything a reviewer would want to reconstruct later. It never throws, so
it cannot fail the operation it describes:

```js
await auditService.recordChange({
  action: 'inventoryItem.updated',
  category: 'data',
  target: { type: 'inventory', id: doc.id, label: doc.code },
  before, after, req
});
```

---

## Frontend

Nothing is required for the module to appear in navigation — the menu is data.

Add a screen only when the generic ones are not enough:

Add a route in `frontend-vue/src/router/index.js` with a `permission` meta, and
a view under `src/modules/<module>/views/`.

Use `DataTable` for lists — it already speaks the backend's list-query
contract. Hide actions with `v-can`; it is presentation only, and the API
enforces the same rule.

Follow [frontend-standards.md](frontend-standards.md) for the rest: page
header, buttons, form fields and the required-field marker each have one place
they are defined, and a screen should inherit them rather than restate them.
**Responsive is a requirement, not a later pass** — the screen has to work at
360px before it is finished.

---

## Before you open a pull request

```sh
npm --prefix backend-node run verify:modules
npm --prefix backend-node run test
npm --prefix backend-node run lint
```

`verify:modules` catches, without a database:

- a malformed or duplicated manifest
- a route guarded by an undeclared permission resource
- a setting descriptor that fails validation, or a duplicate key
- a menu item referencing a permission nobody declares
- a dependency on a missing module, or a cycle
- an async handler that is not wrapped

---

## Disabling a module

```sh
MODULES_DISABLED=inventory
```

Its routes, permissions, settings and menu entries disappear on the next boot.
Roles that still grant a now-missing permission are reported by
`npm run sync:permissions` rather than silently repaired — a vanished
permission usually means a module was disabled by mistake, and quietly
stripping grants would hide that.
