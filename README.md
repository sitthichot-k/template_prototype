# Enterprise Platform Template

A blueprint that generates production-shaped child projects. It behaves like an
SDK rather than a starter kit: the platform layer is a contract you build
against, not a pile of code you edit.

**Phase 1 ships two complete modules — Access Control and Settings — plus the
kernel that makes adding a third one a folder rather than a refactor.**

```
node tools/generator/bin/create-project.js \
  --project-code hrms --project-name "HR Management System" \
  --domain hrms.example.com --registry registry.example.com --out ../hrms

cd ../hrms && make up && make seed
```

Two inputs are required — `--project-code` and `--project-name`. Everything
else has a default, and every secret for the local tier is generated for you.
The deploy tiers keep `CHANGE_ME` placeholders on purpose; see
[docs/guides/secrets-management.md](docs/guides/secrets-management.md).

---

## What you get

| Layer | Choice | Why |
|---|---|---|
| Database | MongoDB 7 + Mongoose | Documents suit configurable, per-tenant-shaped data |
| Cache / sessions | Redis 7 | Shared rate-limit counters and permission cache across replicas |
| Backend | Node 20 + Express, CommonJS | Matches the existing house style; no build step between source and production |
| Frontend | Vue 3 | Renders itself from the bootstrap contract, so a backend module needs no frontend work |
| Delivery | Docker Compose, three tiers | The same topology from a laptop to production |

---

## The four dynamic pillars

Everything below exists so that *changing what the app does* rarely means
*changing platform code*.

### 1. Modules self-register

A backend module is a folder with a `module.manifest.js`. Drop it in and its
routes, permissions, settings, menu entries, jobs and seeds are live on the
next boot. There is no central registry file to edit and therefore none to
forget.

```sh
npm --prefix backend-node run make:module -- inventory --resource /operations/inventory
```

That produces a working, permission-guarded CRUD module. See
[docs/guides/module-authoring.md](docs/guides/module-authoring.md).

### 2. Permissions come from code

The permission catalogue is derived from module manifests and projected into
MongoDB on every boot. Code is the source of truth, so the catalogue can never
drift from what the API actually enforces — and a route guarded by a resource
nobody declared fails the boot instead of failing silently.

Authorization is RBAC with an ABAC overlay: roles grant `resource + action`,
policies add conditions, and an explicit deny always wins.

### 3. Settings are declared, not built

A setting is one descriptor object in a manifest. From it the platform derives
validation, storage, encryption-at-rest for secrets, the permission needed to
change it, and the form control that renders it — in **both** frontends.

Adding a setting requires no migration, no endpoint and no screen.

### 4. The UI is data

`GET /api/v1/platform/bootstrap` returns the user, their effective permissions,
the navigation tree (already filtered), every resolved setting, and the feature
flags. The shell renders itself from that payload, which is why a new backend
module appears in the app without the frontend being touched at all.

---

## Repository layout

```
├── backend-node/            Express API
│   ├── config/              Validated configuration - the only reader of process.env
│   ├── middleware/          Platform-wide HTTP middleware
│   ├── database/migrations/ Ships inside the image so it can run in production
│   └── server/
│       ├── core/            The platform. Feature code depends on this; it depends on nothing.
│       │   ├── kernel/      Module discovery, registry, application factory
│       │   ├── http/        Envelope, validation, pagination, error translation
│       │   ├── db/          Connection, cache, base schema, base repository
│       │   ├── security/    Authn, authz, permission resolution, identity providers
│       │   ├── settings/    Descriptor contract and resolution
│       │   └── audit/       Append-only trail
│       └── modules/         Features. One folder each, self-describing.
│           ├── access-control/
│           ├── settings/
│           └── platform/
├── frontend-vue/            Vue 3 shell, rendered from the bootstrap contract
├── infra/                   nginx, mongo init scripts
├── tools/generator/         The child-project generator (never copied into a child)
├── docs/                    Architecture, ADRs, guides
├── .env.{local,preproduction,production}
└── docker-compose.yml + one overlay per tier
```

The `core/` ↔ `modules/` split is the one boundary that matters: **core never
imports from a module.** That is what lets a module be deleted, disabled or
replaced without the platform noticing.

---

## Three tiers, everywhere

Env files, compose overlays and frontend build modes all use the same three
names, so there is never a question of which pairs with which.

| Tier | Env file | Compose overlay | Shape |
|---|---|---|---|
| `local` | `.env.local` | `docker-compose.local.yml` | Bind-mounted source, hot reload, datastores published to the host |
| `preproduction` | `.env.preproduction` | `docker-compose.preproduction.yml` | Production hardening, non-production data |
| `production` | `.env.production` | `docker-compose.production.yml` | Registry images only, read-only containers, replicas |

Always drive them through the wrapper, which pairs the env file with the
correct overlay and refuses to deploy a tier that still contains `CHANGE_ME`:

```sh
./scripts/compose.sh local up -d --build       # bash
.\scripts\compose.ps1 local up -d --build      # PowerShell
```

Running an overlay on its own fails with *"service has neither an image nor a
build context"* — the overlay carries only the tier's differences, and the base
`docker-compose.yml` holds the service definitions. The wrappers exist so that
pairing is never something you have to remember.

See [ENVIRONMENTS.md](ENVIRONMENTS.md).

---

## Getting started

```sh
make up        # start the local stack
make seed      # system roles + bootstrap administrator (password printed once)
make logs
```

| URL | What |
|---|---|
|  http://127.0.0.1:8080 | Frontend |
| http://127.0.0.1:8081/api/v1 | API |
| http://127.0.0.1:8081/docs | OpenAPI (local and preproduction only) |
| http://127.0.0.1:8081/healthz | Liveness |

`make help` lists everything else.

---

## Verifying a change

```sh
make verify
```

Runs lint, the test suite, `verify-module-contracts` (which catches a route
guarded by an undeclared permission, a duplicate setting key, a dependency
cycle, and an unwrapped async handler), and a compose config check.

---

## Security posture

- Secrets never reach git. `.gitignore` denies by default and allows only
  `*.example`.
- Passwords are argon2id. Refresh tokens are stored hashed and rotate on every
  use; reuse of a rotated token revokes the whole session family.
- A permission change bumps the user's `permissionVersion`, which invalidates
  their cached permission map **and** every access token they hold, on the next
  request.
- Settings marked `secret` are AES-256-GCM encrypted at rest and never returned
  to a client.
- Containers run as non-root, read-only, with `cap_drop: ALL`.
- Production refuses to start without an explicit CORS allowlist, and refuses
  to deploy on a mutable `latest` image tag.

See [docs/guides/secrets-management.md](docs/guides/secrets-management.md).

---

## Documentation

| Document | Read it when |
|---|---|
| [docs/architecture/overview.md](docs/architecture/overview.md) | You want the request path end to end |
| [docs/guides/module-authoring.md](docs/guides/module-authoring.md) | You are adding a feature |
| [docs/guides/frontend-standards.md](docs/guides/frontend-standards.md) | You are touching the UI — responsive rules, forms, buttons, headers |
| [docs/guides/access-control.md](docs/guides/access-control.md) | You are modelling roles or debugging a denial |
| [docs/guides/secrets-management.md](docs/guides/secrets-management.md) | You are deploying or rotating a key |
| [ENVIRONMENTS.md](ENVIRONMENTS.md) | You are configuring a tier |
| [docs/adr/](docs/adr/) | You want to know why something is the way it is |
| [docs/prd/template-generator.md](docs/prd/template-generator.md) | You are working on the generator, or want to know what a generated project receives |
