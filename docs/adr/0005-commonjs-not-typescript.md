# 0005 — Plain CommonJS JavaScript on the backend

**Status:** Accepted

## Context

TypeScript is the default answer for a new enterprise Node service, and its
advantages here would be real: typed manifests, a shared contract between
backend and frontend, compile-time checks on the permission strings this
template cares so much about.

Against that: the team's existing services are all plain
CommonJS Express. The template's purpose is to be adopted, and an adoption that
requires the team to change language, build tooling and debugging workflow on
the same day they adopt a new architecture is an adoption that stalls.

## Decision

Backend stays CommonJS JavaScript, matching the reference projects. Node 20,
Express 4, no transpile step.

The checks TypeScript would have provided are supplied by other means:

- **Joi at every boundary** — environment (`config/index.js`), module manifests,
  setting descriptors, and every HTTP request. These validate *runtime* values,
  which is where the failures actually occur.
- **`verify-module-contracts`** — a static pass over the source, in CI, without
  a database. It catches undeclared permission resources, duplicate setting
  keys, dependency cycles, and unwrapped async handlers.
- **JSDoc on exported functions** — editors give completion and inline docs
  without a build.

## Consequences

**Good.** A developer moving from an existing project reads this one without
learning anything new. The production image runs the same files that were
reviewed — no source map step, no "works in dev, fails in the bundle". `node
--check` is the whole syntax gate.

**Costs.** No compile-time type checking. A refactor that changes a function
signature is caught by tests and review, not by the compiler. Backend and
frontend cannot share types.

The mitigations above cover the failure modes that actually bite in this
codebase — a wrong permission string, a malformed manifest, a missing env
variable — but they do not cover ordinary type errors, and that is a genuine
gap rather than a solved problem.

## Revisiting

This decision is worth reopening when any of these becomes true:

- new projects start in TypeScript, making CommonJS the unfamiliar choice
- the frontend/backend contract grows past what the bootstrap payload
  documents comfortably
- a type-related production incident occurs that the current checks would not
  have caught

The migration path is incremental: `checkJs` with JSDoc first, then `.ts` file
by file. The `core/` ↔ `modules/` boundary makes it possible to convert core
alone and leave feature modules in JavaScript.

## Alternatives considered

**TypeScript with ESM.** The technically stronger choice, rejected on adoption
risk for phase 1.

**JavaScript with `checkJs` and JSDoc.** Genuinely tempting, and the likely
first step if this is revisited. Left out of phase 1 only to avoid a
half-typed codebase where the annotations are trusted more than they deserve.
