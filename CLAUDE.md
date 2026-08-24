# CLAUDE.md

Instructions for AI coding agents working in this repository — Claude Code or
any other agent reading this file. It is committed and versioned like any
other source file, unlike editor- or account-level memory, so treat it as the
authoritative, reviewable set of rules for this codebase.

## What this is

__PROJECT_NAME__ is a Node 20 + Express (CommonJS) backend over MongoDB and
Redis, with a Vue 3 frontend. Backend features are self-registering modules
under `backend-node/server/modules/`; almost everything an administrator can
configure — permissions, settings, navigation — is data resolved at runtime,
not code compiled in. See [README.md](README.md) for the full picture and
[docs/adr/](docs/adr/) for why it is shaped this way.

## Stack

| Layer | Choice |
|---|---|
| Database | MongoDB 7, via Mongoose |
| Cache / sessions | Redis 7 |
| Backend | Node 20, Express 4, CommonJS — no TypeScript, no build step (see ADR 0005 in `docs/adr/`) |
| Frontend | Vue 3, rendered from the `/platform/bootstrap` contract |
| Delivery | Docker Compose, three tiers: `local`, `preproduction`, `production` |

Node version is pinned in `.nvmrc`. Use it.

## `core/` vs `modules/` — the one boundary that matters

`backend-node/server/core/` is the platform: kernel, http envelope, db,
security, settings resolution, audit. `backend-node/server/modules/` is
features: one folder per module, each with a `module.manifest.js`.

**`core/` never imports from a `module`.** That is what lets a module be
deleted, disabled or replaced without the platform noticing (ADR 0002). If
you find yourself importing a module's service from `core/`, the logic
belongs in `core/` instead.

## Adding a feature = adding a module

Modules are discovered by scanning the filesystem on boot — there is no
central registry file to edit, and therefore none to forget:

```sh
npm --prefix backend-node run make:module -- inventory \
  --label "Inventory" --resource /operations/inventory --group Operations
```

That scaffolds a manifest, model, service, controller, routes, validators
and a contract test. See `docs/guides/module-authoring.md` for the full
contract.

> On Git Bash, prefix scaffolder commands with `MSYS_NO_PATHCONV=1` — Bash
> rewrites a leading `/` in `--resource` into a Windows path otherwise.

## Permissions and settings are declared, not built

A permission is a resource path plus its valid actions, declared in a
module's manifest:

```js
permissions: [{ resource: '/operations/inventory', actions: ['view', 'create', 'edit'], group: 'Operations' }]
```

**Every resource passed to `requirePermission(...)` in a route must exist in
some manifest**, or the boot fails and `verify-module-contracts` fails CI
first (ADR 0003). Never add a permission string to a route without adding
the matching manifest entry in the same change.

A setting is one descriptor object; the platform derives validation,
storage, encryption (`secret: true`) and the form control from it — no
migration, no endpoint, no screen (ADR 0004). See the guide for the full
descriptor shape.

## The UI renders itself — don't hardcode navigation

`GET /api/v1/platform/bootstrap` returns the signed-in user's permissions,
the already-filtered menu tree, resolved settings and feature flags. The Vue
shell renders from that payload (ADR 0006). A new module's `menu` entry
appears in the app with no frontend change — if you find yourself
hardcoding a route or nav item in `frontend-vue/`, check whether it should
be a `menu` entry in the module manifest instead.

## Before you say something is done

```sh
make verify
```

Lints and tests both projects, runs `verify-module-contracts` (catches an
undeclared permission resource, a duplicate setting key, a dependency
cycle, an unwrapped async handler), checks that `infra/nginx/default.conf`
and `frontend-vue/nginx/default.conf` have not drifted, and validates the
compose config. A change is not finished until this passes.

## Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/)
(`fix:`, `feat:`, ...) — check `git log --oneline` for the current pattern
before writing a message.

## Never commit env files

`.gitignore` denies `.env*` by default and allows only `*.example` files
back in. If a change needs a new variable, add it to the relevant
`.env.example` / `.env.<tier>.example`, not just to your local
`.env.<tier>`.

<!-- >>> template-only -->

## This repository is a template, not an application

`__PROJECT_NAME__` in the first section above will read like a raw,
unresolved token if you are looking at this file inside the template
itself rather than a generated child — that is expected, not a bug; see
"How generation works" below. Everything above this marker travels into
every generated project and is written for that project's engineers, who
have never seen this repository. Judge a change to that part of this file
by whether it is a rule you can defend to all of them, not just to whoever
is using this specific checkout.

The corollary that should guide every architectural call in the template
itself: prefer mechanisms that adapt themselves — manifest-driven
permissions, settings, menus — over anything a child project would have to
hand-edit. A generator flag or a hardcoded default made here is a decision
made once for every project that will ever exist from this template. That
is a higher bar than "does this work for this one screen", and it is the
bar architectural pushback in this repo is measured against.

## How generation works

```sh
node tools/generator/bin/create-project.js --project-code <slug> \
  --project-name <name> --out <dir>          # --help for the rest
```

copies this tree into `--out`, in order:

1. **`.templateignore`** (gitignore syntax) excludes paths entirely —
   `tools/generator/` itself (a generated project is an application, not a
   template, and shipping the generator would invite someone to
   re-generate on top of their own work), `.claude/`, `.vscode/`, real
   `.env*` files, and `docs/prd/` (requirements for the template itself,
   not the child).
2. **Template-only regions** are stripped from files that do travel but
   need parts removed — an opening comment line and a matching closing
   comment line bracket the region, in whatever comment syntax the file
   uses (`#`, `//`, or an HTML comment as this file does, so it renders
   invisibly). This file brackets everything from just above this
   numbered list down to the last line of the file; `Makefile` and
   `.github/workflows/ci.yml` are the other two. The exact marker text
   is deliberately not reproduced here — a file that is itself subject to
   stripping must not contain a stray copy of its own marker, or the
   stripper closes the region at the copy instead of the real one. It is
   documented, safely, in `stripTemplateOnly` in
   `tools/generator/src/tokens.js` (excluded from every child, so a
   literal example there is inert): an unterminated region throws rather
   than silently eating the rest of the file.
3. **Token substitution** — double underscores around an upper-snake-case
   name, e.g. `__PROJECT_CODE__`. `tools/generator/src/tokens.js` defines
   the token set (`PROJECT_CODE`, `PROJECT_NAME`, `ORG_NAME`, ...). An
   unresolved token is left in place rather than blanked, so it fails
   loudly on first use instead of silently as an empty string. This is
   why raw `__PROJECT_CODE__` tokens sit directly in committed files like
   `backend-node/package.json` — that is not a mistake to "fix".
4. **Env files** are rendered from *this template's own* `.env.<tier>` /
   `.env.<tier>.example`, never from `.env.example` — the tier files carry
   the hardening (`COOKIE_SECURE=true`, `SWAGGER_ENABLED=false`, ...) that
   makes a tier what it is. `local` gets freshly generated secrets;
   `preproduction` and `production` keep `CHANGE_ME` on purpose, so an
   unresolved secret fails loudly at deploy time instead of quietly
   running with a value nobody chose.
5. `docs/adr/` is relocated to `docs/adr/inherited/` in the child, not
   deleted — the reasoning behind `core/`, permissions-in-code, etc. is
   still true for a child project; it just did not make the call itself.

## Editing the generator

Source is `tools/generator/src/{tokens,generate,ignore}.js` and
`tools/generator/bin/create-project.js`. It is deliberately
dependency-free — it has to run on a machine that has only just cloned the
template, before `npm install` — so do not reach for an npm package where
a few lines of plain Node will do.

Its tests live at `tools/generator/test/*.test.js` and are template-only
themselves (a generated child has no generator to test):

```sh
node --test tools/generator/test/*.test.js
```

## The stickyNote reference

`E:\MyApp\stickyNote` (Vue 3 + Express + Mongo, the same general shape as
this template) is the template author's own earlier project and the
reference for **UI, dashboard and logging** patterns specifically:

- `frontend/src/modules/admin/views/DashboardView.vue` — KPI tiles,
  hand-rolled SVG/CSS charts, no chart library.
- `backend/src/modules/log/` + `middleware/logger.js` — one row per API
  request in Mongo.
- `backend/src/modules/admin/service/performance.service.js` — derives
  throughput and latency percentiles from those log rows rather than a
  separate metrics store.

Port the *idea*, fitted to this platform's module manifests and
permission-aware panels — do not copy stickyNote's code or its flat module
layout directly.

## Verifying a template-only change

```sh
node --test tools/generator/test/*.test.js
node tools/generator/bin/create-project.js --yes --project-code probe \
  --project-name "Probe" --out /some/scratch/dir
```

Then read the generated tree. In particular: no `tools/generator/`, no
`new:` target in `Makefile`, no `generate` job in
`.github/workflows/ci.yml`, and this file with everything from its own
`template-only` marker onward gone.

<!-- <<< template-only -->
