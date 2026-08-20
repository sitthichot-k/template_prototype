# 0007 — One frontend flavour: Vue

**Status:** Accepted

**Amends:** [0006 — One bootstrap contract serves every frontend](0006-bootstrap-contract-for-frontends.md)

## Context

The template shipped two frontend shells, Vue 3 and React 18, and
`--frontend vue|react|both` chose between them at generation time. The intent
was that a project team could pick the framework they already knew.

In practice only the Vue shell was ever built against. The React shell was
carried for several months without a project using it, and the cost was not
hypothetical:

- **It lagged, silently.** Every UI change landed in Vue first, and the React
  shell was allowed to fall behind on the understanding that nothing depended
  on it. A shell that is never run is not a supported option — it is an
  untested claim that one exists.
- **It doubled the surface of every frontend decision** — design tokens,
  permission directives, dynamic form rendering — while only one side of the
  pair was ever exercised.
- **The selection machinery had its own bugs.** `--frontend both` skipped the
  step that places `nginx/default.conf` into each build context, so a `both`
  project could not build either production image. Nobody noticed, because
  nobody generated one.

## Decision

The platform ships **one** frontend: `frontend-vue`. The React shell is removed
along with the selection machinery — the `--frontend` flag, the
`FRONTEND_FLAVOUR` token, the per-flavour copy exclusions, and the second set
of frontend env files.

`--frontend` is not silently ignored. Passing anything other than `vue` exits
non-zero and points here, so an existing script that still passes
`--frontend react` fails loudly rather than quietly producing a Vue project.

**ADR 0006 stands.** The bootstrap contract is not withdrawn, and the frontend
remains a consumer of it rather than an owner of navigation, permissions or
branding. What changes is only the count of consumers. Everything 0006 argues
about menus, permissions and branding being *data, not code* still holds, and
still pays for itself with one shell: it is what lets a new backend module
appear in the UI with no frontend change at all.

## Consequences

**Good.** One shell to keep current, one set of design decisions, one place a
UI bug can be. `FRONTEND_CONTEXT` stays in compose as a single-valued variable,
so the path is still stated in one place.

The generator loses a whole class of state: no per-flavour exclusion during the
tree walk, no branch in the env rendering, no branch in the nginx step. That is
about 30 lines and three bugs' worth of surface removed.

**Costs.** A team that wanted React now has a real migration rather than a flag.
This is the trade being accepted deliberately: a supported second flavour would
have to be *built and tested continuously*, and that was not happening.

Reintroducing a second flavour means restoring the selection flag in
`tools/generator/bin/create-project.js`, the exclusion logic in `copyTree`, and
the per-flavour branches in `renderEnvFiles` and `retargetFrontend`. The
bootstrap contract means the new shell would have a specification to build
against rather than a Vue app to reverse-engineer — which is the part worth
preserving, and is preserved.

## Alternatives considered

**Keep the React shell but mark it unsupported.** Rejected: it is what was
already happening informally, and it produced a shell that could not build. An
option in the manifest and a flag in the CLI both read as a promise.

**Extract a shared component library first, then drop React.** Rejected as
solving a problem that no longer exists once there is one shell. ADR 0006
already rejected the shared library on its own merits.

**Move React to a separate repository.** Rejected for now: nothing consumes it,
so the repository would be an archive with a build. The code is recoverable
from backup if a project ever asks for it.
