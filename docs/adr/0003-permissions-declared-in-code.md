# 0003 — Permissions are declared in code and projected into the database

**Status:** Accepted

## Context

In the reference projects the permission catalogue lives partly in an
environment variable (`PROJECT_PERMISSION_PATHS`), partly in an IAM database,
and partly in the string literals passed to `requirePermission` in each route
file.

Nothing keeps those three in step. A permission can exist in the environment
list but be guarded nowhere; a route can guard a path the catalogue never
mentions, in which case nobody can ever be granted it. Both failures are
invisible until someone is wrongly denied — or, worse, wrongly allowed.

## Decision

Module manifests are the single source of truth. `permission-sync` projects the
in-memory catalogue into the `permissions` collection on every boot; rows the
current boot did not touch are deleted.

Two checks make the invariant real:

- `assertResourcesDeclared` (boot, via `onReady`) — every resource guarding a
  route must exist in the catalogue, or the service does not start.
- `verify-module-contracts` (CI, no database) — scans the source for
  `requirePermission(...)` and reports any resource nobody declares.

Editing the `permissions` collection directly has no effect on authorization.
It is a queryable projection, and says so in the model file.

## Consequences

**Good.** A typo in a permission string is a build failure with a filename, not
a support ticket six weeks later. The role editor can only offer permissions
that really exist. `GET /permissions/catalogue` documents exactly what the API
enforces, because it *is* what the API enforces.

Disabling a module removes its permissions and reports which roles still grant
them, rather than silently stripping the grants — a vanished permission usually
means a module was disabled by mistake, and quiet repair would hide that.

**Costs.** Adding a permission requires a deployment. This is the right
trade: what capabilities exist is an application-design decision that belongs
in review. *Who holds them* stays fully runtime-editable, which is the part
that actually changes weekly.

## Alternatives considered

**Database-first, with an admin UI to define permissions.** Rejected: it lets
the catalogue drift from what the code checks, and creates a class of
permission that is grantable but enforced nowhere.

**Environment variable, as in the reference projects.** Rejected: a
comma-separated list in an env file has no validation, no description, no
per-resource action list, and no connection to the code that enforces it.
