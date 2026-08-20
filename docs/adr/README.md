# Architecture decision records

Short records of decisions that were not obvious, written so a future reader
can tell whether the reasoning still holds. Each states the forces at the time,
not just the outcome.

| # | Decision | Status |
|---|---|---|
| [0001](0001-self-contained-access-control.md) | Own access control in MongoDB, with a pluggable identity provider | Accepted |
| [0002](0002-filesystem-module-discovery.md) | Discover modules by filesystem scan, not a registry file | Accepted |
| [0003](0003-permissions-declared-in-code.md) | Permissions are declared in code and projected into the database | Accepted |
| [0004](0004-schema-driven-settings.md) | Settings are declared descriptors, rendered generically | Accepted |
| [0005](0005-commonjs-not-typescript.md) | Plain CommonJS JavaScript on the backend | Accepted |
| [0006](0006-bootstrap-contract-for-frontends.md) | One bootstrap contract serves every frontend | Accepted, amended by 0007 |
| [0007](0007-single-frontend-flavour.md) | One frontend flavour: Vue | Accepted |

## Writing a new one

Copy the shape of an existing record: context, decision, consequences,
alternatives considered. Keep it to a page. An ADR that needs a second page is
usually two decisions.

Records are immutable once accepted. To change a decision, write a new record
that supersedes it and update the status of the old one — the history is the
point.
