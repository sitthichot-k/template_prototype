# 0004 — Settings are declared descriptors, rendered generically

**Status:** Accepted

## Context

The reference projects have a settings module per concern: `setting-message`,
`message-status`, `group`, `verification`, `auth_message`,
`email_notifications`, `email_delivery`, `email_workflow`, `runtime_access`,
`database_backup`. Each is a model, a service, a controller, a route group and
a frontend screen.

Adding one configurable value therefore costs roughly five files and a
migration. The predictable outcome is that values which *should* be
configurable end up as constants, and changing them becomes a deployment.

## Decision

A setting is one descriptor object in a module manifest:

```js
{
  key: 'security.password.minLength',
  group: 'security', section: 'password',
  label: 'Minimum password length',
  type: 'number', default: 12, min: 8, max: 128,
  permission: { resource: '/settings/security', action: 'edit' }
}
```

From it the platform derives validation on write, the storage row, encryption
at rest when `secret: true`, the permission required to change it, and the form
control that renders it — in both frontends.

`GET /settings/schema` returns descriptors filtered by the caller's
permissions; `PUT /settings` validates each key against its descriptor and
checks its permission individually. One generic screen serves every group.

Only overrides are stored. A setting at its default has no row.

## Consequences

**Good.** Adding a setting is one object. No migration, no endpoint, no screen,
and it appears in the Vue app and the React app simultaneously. Because it is
cheap, values genuinely become configurable instead of hardcoded.

Resolution is `user → organization → global → default`, so a module can read a
setting without checking whether anyone has ever configured it.

Secret settings are encrypted with AES-256-GCM and never returned to a client —
the form shows "set" or "not set", and an empty submission is skipped rather
than clearing the stored value.

**Costs.** Adding a new setting *type* means a branch in both `SchemaField`
implementations. That is the deliberate trade: the frequent operation is free,
the rare one costs two files.

Descriptors are validated at module load, so a malformed one fails the boot
rather than the first administrator who opens the page.

Rotating `ENCRYPTION_KEY` requires re-encrypting stored secrets. Documented in
[secrets-management.md](../guides/secrets-management.md); the failure mode is
deliberately loud in logs but non-fatal, since one undecryptable value should
not take the settings read down.

## Alternatives considered

**A model and screen per settings area, as in the reference projects.**
Rejected: the cost per setting is what suppresses configurability.

**A single free-form JSON blob.** Rejected: no validation, no per-key
permission, no UI, and no way to know what keys are legitimate.
