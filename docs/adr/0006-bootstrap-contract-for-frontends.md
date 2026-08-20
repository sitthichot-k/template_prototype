# 0006 — One bootstrap contract serves every frontend

**Status:** Accepted — amended by
[0007](0007-single-frontend-flavour.md), which reduced "every frontend" to one.
The contract itself stands; only the number of consumers changed.

## Context

The template ships a Vue shell and a React shell, and a child project picks
one. Two shells means either two implementations of the same behaviour, which
drift, or a shared component layer, which forces both to use the same rendering
model.

Meanwhile the frontend needs to know several things it cannot compute: which
menu entries this user may see, which actions to offer, what the app is called,
which features are on. In the reference projects these live in the frontend as
hardcoded route tables and menu arrays, so adding a backend feature requires a
matching frontend edit — and the two get out of step.

## Decision

`GET /api/v1/platform/bootstrap` returns everything the shell needs to render
itself:

```
user, permissions.granted, menu (already permission-filtered),
settings, features, modules, server
```

Both shells are consumers of that payload. Neither is the reference
implementation. Navigation, visible actions, branding and feature flags are
data, not code.

The menu is filtered **on the server**, including removing containers whose
children were all filtered out. Filtering on the client would duplicate a rule
that has to exist on the server anyway.

## Consequences

**Good.** A new backend module with a menu entry appears in both shells on the
next bootstrap call, with no frontend change. The shells cannot drift on
navigation or permissions, because neither owns them.

One round trip after sign-in replaces what would otherwise be several
(`/me`, `/permissions`, `/settings`, `/menu`).

Re-branding is a settings change: the store writes `branding.primaryColor` onto
`:root` as a CSS custom property, so a child project re-themes without a
rebuild.

**Costs.** The payload grows with the number of settings and menu entries. At
phase-1 scale (28 settings, 12 permissions) it is a few kilobytes; a project
with hundreds of settings should split `settings` behind a second call.

It is a cache-invalidation point: anything that changes a user's permissions
must trigger a re-bootstrap. `permissionVersion` handles this — a stale token
is rejected with `PERMISSIONS_CHANGED`, the client refreshes, and the new
bootstrap follows.

Frontend permission checks (`v-can`, `<Can>`) are presentation only. The API
enforces the same rule on every request. This must stay explicit in review, or
someone will eventually treat a hidden button as a security control.

## Alternatives considered

**A shared component library across Vue and React.** Rejected: it constrains
both frameworks to the lesser common denominator, and the interesting shared
logic is the *contract*, not the widgets.

**Hardcoded route and menu tables per shell, as in the reference projects.**
Rejected: it is precisely the coupling that makes adding a module a
three-repository change.
