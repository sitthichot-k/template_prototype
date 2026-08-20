# PRD — Template Generator

| | |
|---|---|
| **Status** | Draft |
| **Owner** | Platform team |
| **Last updated** | 2026-08-04 |
| **Applies to** | `tools/generator/`, `.templateignore`, `template.manifest.json` |
| **Related** | [ADR index](../adr/README.md), [architecture overview](../architecture/overview.md) |

---

## 1. Summary

The Template Generator turns this repository into a **new, independent
application repository**. It is the only supported way to start a project on
the platform.

The distinction that drives every requirement below: a generated project is
**generated, not forked**. It does not inherit git history, it does not carry
the generator, and it never re-runs generation on top of itself. What it
inherits is a platform layer with a stable contract, plus enough provenance to
tell later what came from the template and what the team wrote themselves.

---

## 2. Problem

Starting an enterprise app on this stack means reproducing about a dozen
decisions that have nothing to do with the app: access control, settings,
module discovery, three environment tiers, container hardening, secret
handling, nginx, Mongo indexes. Copying a previous project carries all of it
plus that project's domain code, its dead branches, and its stale secrets.

The cost is not the first day — it is month six, when four projects have each
diverged in their own direction and a security fix has to be applied four
different ways.

**The generator exists to make "start correctly" cheaper than "start by
copying."**

---

## 3. Goals and non-goals

### Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Two inputs produce a running project | `--project-code` + `--project-name` → `make up && make seed` works with no hand-editing |
| G2 | A child is an application, never a template | No generator, no template manifest, no template-author material reaches a child |
| G3 | A child is credible on day 1, not just bootable | Lint, tests, contract check and a compose config check all pass in CI on the first commit |
| G4 | A child stays diffable against its origin | Any file can be classified as *untouched since generation* or *modified by the team* |
| G5 | A child gets only what it asked for | Frontend flavour and optional modules are selected, not deleted afterwards |
| G6 | Deploy tiers cannot be deployed accidentally | Preproduction and production keep `CHANGE_ME` until a human resolves them |

### Non-goals

- **Not a re-generator.** Running the generator over an existing project is out
  of scope permanently. Upgrades are diff-based (§7), never regeneration.
- **Not a scaffolding CLI for features.** Adding a module inside a project is
  `npm run make:module`, which already exists and ships to the child.
- **Not a package manager.** The platform layer is copied, not consumed as a
  dependency. See §9 for why, and what would change that.
- **Not multi-stack.** Node + Express + Mongo + Vue only. A second frontend
  flavour was tried and retired ([ADR 0007](../adr/0007-single-frontend-flavour.md));
  a second backend runtime is a different product.

---

## 4. Users

| Persona | Uses the generator | Needs |
|---|---|---|
| **Project lead** starting a new system | Once, on day 1 | A repo that runs, has CI, and can be handed to a team the same afternoon |
| **Developer** on a generated project | Never directly | To not be able to tell which parts were generated — the code must read as one codebase |
| **Platform maintainer** | Continuously | Confidence that a fix made here reaches existing children through a readable diff |
| **Security reviewer** | At handover | Evidence that no secret, no template hostname and no development default reached a deploy tier |

---

## 5. The child bill of materials

The central design question: **what should a generated project actually
receive?** Three principles decide every line of the table.

> **P1 — A child is an application, not a template.**
> Anything that only makes sense to someone maintaining the template must not
> travel. A leftover template artefact in a child is worse than a missing one,
> because it invites someone to use it.

> **P2 — A child must be correct on its first commit, not just its first boot.**
> Booting is table stakes. The first pull request is where a project's
> standards are actually set, so the checks have to exist before the first
> feature does.

> **P3 — A child must remain diffable against its origin.**
> Diff-based upgrade is the stated strategy. It only works if the generation
> baseline is recorded — otherwise "what did we change?" is unanswerable by
> month six.

### 5.1 What travels

| Category | Contents | Principle | Status |
|---|---|---|---|
| **Platform runtime** | `backend-node/server/core/`, core modules `access-control`, `settings`, `platform`, `observability` | — | ✅ Shipping |
| **Frontend** | `frontend-vue/`, with its nginx build context in place | P1 | ✅ Shipping |
| **Delivery** | `docker-compose.yml` + 3 overlays, `scripts/compose.{sh,ps1}`, `infra/`, Dockerfiles, `Makefile` | — | ⚠️ Makefile leaks a generator target |
| **Identity** | Tokenised package names, image names, DB name, permission root, 9 env files, `project.manifest.json` | — | ✅ Shipping |
| **Local secrets** | Randomly generated per project, local tier only | G6 | ✅ Shipping |
| **Developer tooling** | `npm run make:module`, `verify-module-contracts`, migrations, seeds | P2 | ✅ Shipping |
| **Narrative** | A README about *this application*; docs reframed as inherited | P1 | ❌ **Missing** |
| **Quality gates** | CI workflow, secret scan, dependency policy | P2 | ❌ **Missing** |
| **Provenance** | Template version, generation manifest, per-file hashes, baseline git tag | P3 | ⚠️ Version only |
| **Legal / release** | `LICENSE`, `CHANGELOG.md` seeded at `1.0.0` | P1 | ❌ **Missing** |
| **Selected extras** | Optional modules the caller asked for, and nothing else | G5 | ❌ **Missing** |

### 5.2 What must never travel

| Excluded | Why |
|---|---|
| `tools/generator/` | A child that can generate invites someone to regenerate over their own work |
| `template.manifest.json` | Describes the template; `project.manifest.json` replaces it |
| Template `.env.*` files | They hold the template author's local secrets |
| `.claude/`, `.vscode/`, `.idea/` | Belongs to whoever works on the template |
| `docs/adr/README-template-authors.md` | Template-authoring guidance |
| `make new` target | **Currently leaks** — invokes a script the child does not have |
| The template's `README.md` | **Currently leaks** — a project called "Demo App" ships a README titled *Enterprise Platform Template* |

### 5.3 Inherited decisions

The six ADRs are copied verbatim today. They should still travel — a developer
asking "why CommonJS?" deserves the answer — but framed as **inherited**, under
`docs/adr/inherited/`, with the child's own `docs/adr/` left empty and numbered
from `0001`. Inherited records are immutable in the child; superseding one is a
new record in the child's own series.

Rationale: an ADR that reads *"we decided"* when the reader's team decided
nothing is confusing, and worse, it discourages them from writing their own.

---

## 6. Functional requirements

Phases run in order. Each is independently reportable under `--dry-run`, and a
failure names its phase rather than leaving a half-written project.

| # | Phase | Requirement | Status |
|---|---|---|---|
| F1 | `validate-inputs` | Reject an invalid code, colour or locale. Report **all** errors at once. Refuse to write inside the template. Refuse a non-empty target. | ✅ |
| F2 | `copy-tree` | Walk the template honouring `.templateignore`. Copy binaries verbatim. Prune directories emptied by exclusion. | ✅ |
| F3 | `apply-tokens` | Substitute `__TOKEN__`. Leave unknown tokens **in place** and report them — a silent empty string is harder to notice than a loud marker. | ✅ |
| F4 | `strip-template-only` | Remove regions marked template-only from copied text files, so one file can serve both audiences. | ✅ New |
| F5 | `place-nginx-context` | Place `nginx/default.conf` inside the frontend's build context, since Docker cannot `COPY` from outside one. Frontend *selection* was removed with the React shell ([ADR 0007](../adr/0007-single-frontend-flavour.md)). | ✅ Fixed |
| F6 | `render-env-files` | Render each tier from that tier's own template file, never from `.env.example`. Overwrite every secret-bearing key. | ✅ |
| F7 | `generate-secrets` | Cryptographically random, base64url, local tier only. Deploy tiers keep `CHANGE_ME`. | ✅ |
| F8 | `install-optional-modules` | Install only requested optional modules; record them in the child manifest. | ❌ Declared, unimplemented |
| F9 | `write-child-manifest` | Record template name, version, compat profile, timestamp, inputs, selected modules. | ⚠️ No module list |
| F10 | `record-baseline` | Write a manifest of per-file SHA-256 hashes; optionally `git init` + commit + tag `template-baseline`. | ❌ Missing |
| F11 | `render-child-narrative` | Generate the child's own README, LICENSE and CHANGELOG; relocate inherited ADRs. | ❌ Missing |
| F12 | `install-quality-gates` | Emit a CI workflow running lint, tests, contract verification and compose config check. | ❌ Missing |
| F13 | `post-generate-verify` | Assert the result: no unresolved token outside the allowlist, no `CHANGE_ME` in local, no template hostname in any tier, compose config parses. Non-zero exit on failure. | ❌ Declared, unimplemented |

### Cross-cutting requirements

- **Dependency-free.** The generator must run on a fresh clone before any
  `npm install`. Node standard library only.
- **`--dry-run` writes nothing** and reports what each phase would do.
- **Idempotent target check.** Never write into a non-empty directory.
- **The manifest is not allowed to lie.** Every phase listed in
  `template.manifest.json` must be implemented; F8, F10–F13 are currently
  declared but absent, which is a defect in itself.

---

## 7. Upgrade model

A child never regenerates. Upgrading means **diffing against the template at a
known version and applying what you want.** That is the whole strategy, and it
places one hard requirement on the generator: record the baseline (F10).

With per-file hashes, a future `npm run template:diff` can classify every file:

| Class | Meaning | Action on upgrade |
|---|---|---|
| **Untouched** | Hash matches generation | Apply the template's change automatically |
| **Modified** | Team edited it | Show a three-way diff; never auto-apply |
| **Added** | Not from the template | Ignore |
| **Removed** | Deleted deliberately | Ignore, do not resurrect |

Without the baseline, every upgrade is a manual review of the entire tree,
which in practice means upgrades stop happening. The hash manifest is cheap to
write and is the difference between an upgrade path and an aspiration.

The `core/` ↔ `modules/` boundary is what makes this tractable: platform
changes land in `core/`, which teams are not expected to edit, so most upgrades
touch only untouched files.

---

## 8. Success metrics

| Metric | Target |
|---|---|
| Time from command to first successful login | < 10 minutes on a clean machine |
| Manual edits required before `make up` succeeds | 0 |
| Manual edits required before CI passes | 0 |
| Template artefacts found in a generated child | 0 |
| Secrets or template hostnames in a deploy tier | 0, enforced by F13 and by `scripts/compose.sh` |
| Files needing manual review on a minor template upgrade | Only files the team modified |

---

## 9. Open questions

1. **Copy vs. package.** Publishing `core/` as a private npm package would make
   upgrades a version bump instead of a diff. It also makes the platform layer
   unreadable and unpatchable in place, which is a bad trade while the platform
   is still young. Revisit once `core/` has been stable across three consecutive
   children.
2. **Optional-module granularity.** `notification` and `file-storage` are
   plausible as generation-time choices. `workflow` and `form-builder` may be
   better as runtime feature flags, given the platform already has a settings
   engine. Deciding this shapes F8.
3. **Interactive mode.** The CLI is flag-driven. A prompted wizard is friendlier
   for the once-a-quarter user but adds a second input path to keep correct.
   Flags first; prompts only if the once-a-quarter case proves painful.
4. **Do inherited ADRs belong in the child at all**, or should the child link
   back to the template repository? Copying keeps the child self-contained,
   which is the stronger property for a project that may outlive the template.

---

## 10. Delivery plan

| Phase | Scope | Why this order |
|---|---|---|
| **1 — Truthfulness** | F4, F5, F11 — stop template artefacts leaking; give the child its own README | These are visible on the first `ls`, and they are the difference between "generated" and "half-copied" |
| **2 — Day-1 credibility** | F12, F13, LICENSE/CHANGELOG | The first PR should be checked by the same gates as the hundredth |
| **3 — Upgradeability** | F9 (modules), F10 baseline + hash manifest, `template:diff` | Only worth building once there is a second child to upgrade |
| **4 — Selectivity** | F8, resolves open question 2 | Needs at least one optional module to actually exist |

Phase 1 is implemented alongside this document. Phases 2–4 are proposed, not
committed.
