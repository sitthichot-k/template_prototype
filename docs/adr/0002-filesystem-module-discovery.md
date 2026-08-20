# 0002 — Discover modules by filesystem scan, not a registry file

**Status:** Accepted

## Context

A feature in the reference projects requires edits in several places: the
model, the service, the routes, plus a line in a central route file, plus the
permission paths in `project.config.js`, plus a menu entry in the frontend.

Every one of those is a place to forget. The failure mode of forgetting is
quiet — a route that never mounts, a permission that is never granted, a menu
item that never appears — and it surfaces during someone else's testing rather
than during development.

## Decision

The kernel scans `server/modules/*/module.manifest.js` on boot. A manifest
declares everything the module contributes: routes, permissions, settings, menu
entries, jobs, seeds and lifecycle hooks.

Dropping a folder in registers all of it. There is no central list.

Boot order comes from `order` plus `dependsOn`, resolved topologically. A
missing dependency or a cycle fails the boot with the chain named.

## Consequences

**Good.** Adding a feature touches one directory. `npm run make:module`
scaffolds a correct one, so the right way is also the fastest way. Disabling a
module is an environment variable (`MODULES_DISABLED`), which makes it possible
to ship a module dark and enable it per tier.

Introspection comes free: `GET /platform/modules` reports what is actually
loaded, which is the question that matters during an incident.

**Costs.** A malformed manifest fails the boot rather than being ignored. That
is intended — a module that silently did not load is worse — but it does mean a
typo in one module stops the whole service. The Joi manifest schema and
`verify-module-contracts` (which runs without a database, in CI) exist to catch
this before deployment.

Discovery cost is one `readdirSync` per module at boot. Not measurable.

## Alternatives considered

**A central `modules.js` array.** Rejected: it is the exact line people forget,
and it creates merge conflicts on every parallel feature branch.

**npm packages per module.** Rejected for phase 1: publishing and version
management for internal features is overhead a child project should not carry
on day one. The manifest contract does not preclude it later — a package can
export a manifest just as well as a folder can.
