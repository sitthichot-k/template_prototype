# 0001 — Own access control in MongoDB, with a pluggable identity provider

**Status:** Accepted

## Context

The reference projects this template draws on (rpims, PayHub, can) delegate
both authentication and authorization to a shared external IAM: routes forward
to a B2B admin API, and the project database holds only application context.

That works when the IAM exists and is reachable. It fails in three situations
this template has to serve:

- a child project that starts before any IAM is provisioned
- a project deployed for a different organisation, with its own directory
- local development and CI, where standing up an IAM to run a test is absurd

It also couples every project's permission model to one IAM's schema. Changing
the permission shape means changing a service that other projects depend on.

## Decision

The platform owns identity records, roles, permissions, policies, sessions and
audit in its own MongoDB. An external identity provider is an **adapter**
behind a four-member interface, and only ever answers "who is this person".

`local` (email + argon2id password) is always available. `oidc` is enabled by
listing it in `IDENTITY_PROVIDERS`.

External providers never create accounts. A person must already exist and be
linkable by email; the first successful SSO login links the identity.

## Consequences

**Good.** A generated project runs with `docker compose up` and nothing else.
Authorization is testable without a network. Each project's permission model
evolves independently. Adding corporate SSO later is configuration, not a
rewrite — roles, policies and audit are untouched because they were never the
IAM's concern.

**Costs.** The platform now owns password storage, lockout, session rotation
and reuse detection — code that would otherwise be someone else's problem. It
is written once here rather than per project, and covered by tests, but it is
real surface area.

An organisation running many projects gets one user directory per project
rather than one shared directory. Where that matters, the OIDC adapter plus
pre-provisioned accounts restores single sign-on without restoring the
coupling.

## Alternatives considered

**Keep delegating to IAM.** Rejected: makes the template unusable without a
specific piece of infrastructure, which defeats the purpose of a blueprint.

**Hybrid — local cache synced from IAM.** Rejected for phase 1: two sources of
truth need a reconciliation story, and reconciliation bugs in an authorization
system fail in the direction of granting access. The adapter seam leaves this
open if a project genuinely needs it.
