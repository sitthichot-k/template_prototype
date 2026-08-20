# __PROJECT_NAME__

__PROJECT_DESCRIPTION__

Built on the enterprise platform layer: access control, dynamic settings and
module discovery are already in place, so a new feature is a folder rather than
a refactor.

---

## Getting started

```sh
make up        # start the local stack
make seed      # system roles + bootstrap administrator (password printed once)
make logs
```

| URL | What |
|---|---|
| http://127.0.0.1:8080 | Frontend |
| http://127.0.0.1:8081/api/v1 | API |
| http://127.0.0.1:8081/docs | OpenAPI (local and preproduction only) |
| http://127.0.0.1:8081/healthz | Liveness |

The local tier's secrets were generated when this project was created and are
already in `.env.local`. They are development values — never reuse them.

`make help` lists everything else.

---

## Layout

```
__PROJECT_CODE__/
├── backend-node/
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
├── __FRONTEND_DIR__/
├── infra/                   nginx, mongo init scripts
├── docs/                    Architecture, ADRs, guides
├── .env.{local,preproduction,production}
└── docker-compose.yml + one overlay per tier
```

The `core/` ↔ `modules/` split is the one boundary that matters: **core never
imports from a module.** That is what lets a module be deleted, disabled or
replaced without the platform noticing. It is also what keeps platform upgrades
out of your feature code — see [Upgrades](#upgrades).

---

## Adding a feature

```sh
npm --prefix backend-node run make:module -- inventory \
  --label "Inventory" --resource /operations/inventory
```

That writes a complete working module — manifest, model, repository, service,
controller, routes, validators — already wired to the permission and settings
systems. Restart the backend and the module's routes, permissions, settings and
menu entries appear on their own; nothing central needs editing.

Read [docs/guides/module-authoring.md](docs/guides/module-authoring.md) before
the first one.

If the feature needs a screen of its own, read
[docs/guides/frontend-standards.md](docs/guides/frontend-standards.md) too. It
covers the rules every screen follows — responsive behaviour, required fields,
buttons, headers — and each one has a single place it lives, so a new screen
should be inheriting them rather than re-solving them.

**Every element must be responsive.** A feature is not finished until it works
at 360px wide.

---

## Three tiers

Env files, compose overlays and frontend build modes use the same three names,
so there is never a question of which pairs with which.

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

**The preproduction and production env files still contain `CHANGE_ME`.** That
is deliberate: every one must be resolved from your secret manager before those
tiers are deployed. See
[docs/guides/secrets-management.md](docs/guides/secrets-management.md) and
[ENVIRONMENTS.md](ENVIRONMENTS.md).

---

## Verifying a change

```sh
make verify
```

Runs lint, the test suite, `verify-module-contracts` (which catches a route
guarded by an undeclared permission, a duplicate setting key, a dependency
cycle, and an unwrapped async handler), and a compose config check.

---

## Where this project came from

This project was **generated** from the enterprise platform template — it is
not a fork, and it has no shared git history. `project.manifest.json` records
the template version it came from.

### Upgrades

There is no regeneration step. To take a platform improvement, diff this
project against the template at the version recorded in
`project.manifest.json` and apply what you want. The `core/` ↔ `modules/`
boundary is designed so that platform changes land in files your team has not
edited.

The template's own architecture decision records were inherited with the code
and live in [docs/adr/inherited/](docs/adr/inherited/). They explain why the
platform is shaped the way it is. Decisions **this** team makes belong in
[docs/adr/](docs/adr/), numbered from `0001`.
