# Access control

## Model

```
Permission  resource + actions        declared in a module manifest
Role        bundle of grants          what administrators actually think in
RoleBinding user × role × scope       carries grantor, reason, expiry
Policy      conditional allow/deny    circumstances, not capabilities
User        direct grants and denies  the exceptions every organisation needs
```

Permissions are declared in code and projected into MongoDB on boot. The
`permissions` collection is a queryable copy for the UI — editing a row there
changes nothing. To add a permission, edit the module manifest.

---

## Decision order

```
1. explicit deny        wins over everything, including super-admin
2. policy deny          conditions evaluated against request context
3. super-admin          break-glass role
4. role or direct grant
5. policy allow         can grant what no role covers
```

Deny beating super-admin is the property that makes "revoke this account's
access to X" trustworthy. It is covered by a test.

Wildcards match on path boundaries: `/security/*` grants `/security/users` but
not `/settings/general`, and `/security` does **not** grant `/securityx`.

---

## Seeded roles

| Code | |
|---|---|
| `SUPER_ADMIN` | Bypasses grant checks. Break-glass only. Exactly one such role may exist. |
| `ADMINISTRATOR` | Every permission the loaded modules declare. Re-synced on each seed run so it stays current as modules are added. |
| `SECURITY_OFFICER` | User and role administration, audit read. |
| `VIEWER` | Read-only starting point. |

System roles cannot be renamed or deleted through the API, so a deployment
always retains a way back in.

---

## Designing roles

Model roles on **jobs**, not on screens. `WAREHOUSE_SUPERVISOR` survives a
navigation redesign; `INVENTORY_PAGE_EDITOR` does not.

Prefer a few broad roles plus direct grants for genuine exceptions over a long
tail of near-duplicate roles. A role list nobody can review is a role list
nobody does review.

Reach for a **policy** when the rule is about circumstances rather than
capability — time of day, source network, record ownership. Expressing those as
roles multiplies the role count past the point of usefulness.

```json
{
  "name": "No exports outside office hours",
  "effect": "deny",
  "resources": ["/reports/*", "/security/users"],
  "actions": ["export"],
  "conditions": { "request.hour": { "gte": 18 } },
  "priority": 200
}
```

Test it before switching it on:

```
POST /api/v1/policies/simulate
{ "userId": "…", "resource": "/reports/sales", "action": "export",
  "context": { "request": { "hour": 20 } } }
```

---

## Sessions and tokens

| | Access token | Refresh token |
|---|---|---|
| Form | JWT, stateless | Opaque, stored hashed |
| Lifetime | 10–15 min | 7–14 days |
| Transport | `Authorization` header, memory only | httpOnly cookie scoped to `/auth` |
| Revocable | via `permissionVersion` | yes, immediately |

The access token is never checked against the database for its *contents*, so
the hot path stays fast. Two database-backed checks still run, because a
stateless token cannot express revocation on its own: the session must exist
and not be revoked, and the token's `permissionVersion` must match the user's
current one.

That second check is what makes a permission change take effect on the next
request rather than whenever the token happens to expire.

**Rotation and reuse detection.** Every refresh issues a new token and records
the old hash in `rotatedFrom`. Presenting an already-rotated token means two
parties hold it, so the entire session family is revoked and the user must sign
in again.

The access token is deliberately not persisted in `localStorage`. Persisting it
would turn any XSS into a durable account takeover; the refresh cookie is
httpOnly and restores the session on reload anyway.

---

## Identity providers

`local` is always available. Add `oidc` to `IDENTITY_PROVIDERS` and set the
`OIDC_*` values to enable SSO — the login screen grows a button with no
frontend change.

**External providers never create accounts.** A person must already exist and
be linkable by email; the first successful SSO login links the external
identity to the account. Auto-provisioning would let anyone with an account at
the identity provider into the application, which is almost never what an
enterprise deployment wants.

Adding a provider means implementing four members — `id`, `name`,
`isConfigured()`, `authenticate()` — and registering it. Authorization, roles
and audit are untouched, because the provider only ever answers "who is this
person".

---

## Debugging a denial

1. `GET /permissions/mine` — what the caller actually holds.
2. `GET /users/:id/effective-permissions` — the same for someone else,
   including which roles contributed.
3. `POST /policies/simulate` — whether a policy is the cause.
4. Audit trail, filtered to `authz.denied` — every denial is recorded with the
   resource and action.

Common causes, roughly in order of frequency:

- The role grants the resource but not that specific action — `edit` does not
  imply `delete`, and `view` does not imply `export`.
- A policy denies under the current conditions.
- The user's token predates a role change; the client needs to refresh.
- The resource string in `requirePermission` does not match the manifest.
  `npm run verify:modules` catches this before it ships.

---

## Audit

Recorded automatically: authentication, authorization denials, user lifecycle,
role and permission changes, settings changes.

Entries are append-only — there is no update or delete path in application
code. Retention is enforced by a nightly job driven by the
`security.audit.retentionDays` setting, in batches so a large backlog cannot
hold a write lock long enough to affect request latency.

Writing an audit entry never throws. Losing a line is bad; losing the user's
work because of it is worse.
