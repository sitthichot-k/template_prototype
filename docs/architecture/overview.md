# Architecture

## The one boundary that matters

```
server/core/      the platform      depends on nothing above it
server/modules/   the features      depend on core, never on each other's internals
```

**Core never imports from a module.** That single rule is what makes a module
deletable, disableable and replaceable without the platform noticing, and it is
enforced mechanically: where core genuinely needs something a module owns — the
`Policy` collection, say — it goes through an injectable seam
(`permissionResolver.setPolicyLoader`) rather than a `require`.

Modules reach each other through `mongoose.model(name)` or a service, never by
file path. ESLint blocks the file-path form.

---

## Boot sequence

```
server.js
  ├─ connect MongoDB, connect Redis          (fail fast; no port is opened yet)
  └─ createApplication()
       1. platform middleware        request id → helmet → CORS → parse → log → rate limit
       2. /healthz, /readyz          outside the API prefix and outside auth
       3. discover modules           scan modules/*/module.manifest.js, validate, order
       4. onBoot hooks               permission sync, settings registry binding
       5. mount routers              under config.http.apiPrefix
       6. onReady hooks              assert every guarded resource was declared
       7. 404 + error handler        always last
```

Ordering is not incidental:

- Health answers before modules are ready, so an orchestrator can distinguish
  "starting" from "broken".
- The permission catalogue is written to MongoDB **before** routes mount,
  because the role editor and the seeds both read it.
- `assertResourcesDeclared` runs after every module has registered, so it can
  see the whole catalogue. A route guarded by a resource nobody declares fails
  the boot — not the first request that hits it.

---

## Request path

```
HTTP
 → request id, security headers, CORS, body parse, structured log, rate limit
 → route
 → authenticate            verify JWT → session not revoked → user active
                           → token's permissionVersion matches the user's
 → validate                Joi; the validated value REPLACES the input
 → requirePermission       deny → policy → super-admin → grant
 → controller              translate only
 → service                 business rules
 → repository              scoped query
 → response envelope
```

Two properties are worth stating because they are load-bearing:

**Validation replaces the input.** `req.body` after `validate()` is the parsed,
stripped value. A key absent from the schema never reaches the service, so mass
assignment is structurally impossible rather than defended against.

**`permissionVersion` closes the stateless-token gap.** A JWT cannot be
revoked. Embedding the user's permission version in the token and comparing it
on every request means any change to their access invalidates every token they
hold, immediately — at the cost of one indexed lookup that was already
happening for the session check.

---

## Authorization model

```
Role ──grants──> { resource, actions[] }
 ▲
 └── RoleBinding (user, role, scope, scopeId, expiresAt)

User ──directGrants──> exceptions added
     ──directDenies──> exceptions removed

Policy: effect × subjects × resources × actions × conditions × priority
```

Decision order in `permissionResolver.can()`:

1. **explicit deny** — wins over everything, including super-admin
2. **policy deny** — conditions evaluated against the request context
3. **super-admin** — the break-glass role
4. **role or direct grant**
5. **policy allow** — can grant what no role covers

Deny beating super-admin is deliberate. "Lock this account out of X" has to be
trustworthy even when the account holds the break-glass role.

Policy conditions use a small fixed operator set (`eq`, `in`, `gte`, …), not an
expression language. An authorization rule that can run arbitrary code is an
authorization rule nobody can audit.

**Fail closed.** If the policy store is unreachable, the decision is deny. An
unavailable dependency must never widen access — there is a test for exactly
this.

---

## The bootstrap contract

`GET /api/v1/platform/bootstrap` is the seam between backend and frontend:

```json
{
  "user":        { "id", "email", "displayName", "roles", "mustChangePassword" },
  "permissions": { "superAdmin", "roles", "scopes", "granted": { "/res": ["view"] } },
  "menu":        [ /* already filtered; empty containers removed */ ],
  "settings":    { "general.appName": "…", "branding.primaryColor": "#…" },
  "features":    { "registrationEnabled": false },
  "modules":     ["access-control", "settings", "platform"],
  "server":      { "appName", "version", "environment", "apiPrefix" }
}
```

This is why a new backend module needs no frontend work: navigation, visible
actions, branding and feature flags are all data. The shell is a consumer of
the contract, not the owner of any of it.

Frontend permission checks (`v-can`) are presentation only. The API
enforces the same rule on every request, and that is the boundary that protects
anything.

---

## Caching and invalidation

| Cached | Key | TTL | Invalidated by |
|---|---|---|---|
| Permission map | `perm:<userId>:<version>` | 5 min | version bump (role, grant or status change) |
| Active policies | `policies:active` | 5 min | any policy write |
| Settings per scope | `settings:<scope>:<id>` | 10 min | any setting write |

Versioning the permission key rather than deleting it means a change takes
effect instantly without a cache stampede: the new version is simply a
different key.

Redis degrades gracefully. A cache read failure is a miss, not an error — with
one exception: rate limiting depends on Redis for correctness, so its failure
surfaces. A per-process limiter would multiply the real limit by the replica
count and silently defeat the control.

---

## Data model (phase 1)

| Collection | Holds |
|---|---|
| `users` | Identity, lifecycle, `permissionVersion`, direct grants/denies |
| `roles` | Named grant bundles; `isSystem` roles are protected from the API |
| `permissions` | Catalogue **projected from module manifests** — not a source of truth |
| `rolebindings` | user × role × scope, with grantor, reason and expiry |
| `policies` | ABAC rules |
| `sessions` | One device; hashed refresh token; TTL-indexed |
| `auditlogs` | Append-only; no update path exists in application code |
| `settings` | Overrides only — a setting at its default has no row |

Storing only setting *overrides* keeps the collection small and makes "what has
actually been changed in this deployment" a single query.

---

## Extension points

| You want to | Do this | Touches platform code? |
|---|---|---|
| Add a feature | `npm run make:module` | No |
| Add a permission | One entry in a manifest | No |
| Add a setting | One descriptor in a manifest | No |
| Add a menu entry | One entry in a manifest | No |
| Add an identity provider | Implement the interface, register it, add to `IDENTITY_PROVIDERS` | No |
| Add a setting *type* | One branch in each `SchemaField` | Yes — two files |
| Change the response envelope | `core/http/response.js` | Yes — and every client |

The gradient is the design: the things a project does weekly cost a manifest
entry; the things it does once cost a platform change.
