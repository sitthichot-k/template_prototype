# Environments

Three tiers, one naming scheme. Env files, compose overlays and frontend build
modes all use the same three names — `local`, `preproduction`, `production` —
so there is never a question of which pairs with which.

| Tier | Root env | Overlay | Backend env | Frontend build mode |
|---|---|---|---|---|
| local | `.env.local` | `docker-compose.local.yml` | `backend-node/.env.local` | `--mode local` |
| preproduction | `.env.preproduction` | `docker-compose.preproduction.yml` | `backend-node/.env.preproduction` | `--mode preproduction` |
| production | `.env.production` | `docker-compose.production.yml` | `backend-node/.env.production` | `--mode production` |

---

## Always use the wrapper

```sh
./scripts/compose.sh local up -d --build
./scripts/compose.sh preproduction logs -f backend
./scripts/compose.sh production pull
```

Pairing the wrong env file with the wrong overlay is the single most common
deployment mistake, and it is silent — the stack starts, pointed at the wrong
database. The wrapper makes it impossible, and additionally refuses to:

- run any non-local tier while its env file still contains `CHANGE_ME`
- run production on a missing or `latest` image tag

`make up`, `make seed` and friends call it for you.

---

## Which file holds what

**Root `.env.<tier>`** — compose only: ports, bind addresses, image tags,
resource limits, and which per-service env file to inject. Datastore
credentials live here because compose composes the connection strings from
them.

**`backend-node/.env.<tier>`** — everything the API reads. Every variable is
declared and validated in `config/index.js`; a missing required value fails the
boot rather than the first request that needs it.

**`frontend-*/.env.<tier>`** — build-time only. **Every `VITE_*` value is
embedded in the JavaScript bundle and is therefore public.** Nothing secret
belongs in these files, ever. Anything the browser must not see stays in the
backend env and is reached through the API.

Only `.env.example` is committed. `.gitignore` denies `.env.*` and re-allows
only the `*.example` form.

---

## Tier differences that matter

| | local | preproduction | production |
|---|---|---|---|
| Source | bind-mounted, hot reload | baked into the image | registry image only |
| Datastore ports | published to host | not published | not published |
| Containers | writable | read-only, `cap_drop: ALL` | read-only, `cap_drop: ALL`, replicas |
| Swagger | on | on (QA needs the contract) | **off** — it enumerates every endpoint and permission |
| Log level | `debug`, pretty | `info`, JSON | `warn`, JSON |
| CORS | any loopback origin | explicit allowlist | explicit allowlist, **required to boot** |
| Cookies | `secure=false` | `secure=true`, `SameSite=lax` | `secure=true`, `SameSite=strict` |
| Access token TTL | 15m | 15m | 10m |
| Idle timeout | 8h | 60m | 30m |
| Image tag | `local` | `preprod` | immutable release tag |
| Audit retention | 90d | 180d | 365d |

Production builds are never produced from source by compose. The `production`
overlay resets `build` to null so the image must come from the registry,
already scanned and signed by the pipeline.

---

## Local

```sh
make up                # start
make up-tools          # plus mongo-express (8082) and mailhog (8025)
make seed              # system roles + bootstrap admin, password printed once
make logs
make reset             # stop and delete volumes - destroys local data
```

| URL | |
|---|---|
|  http://127.0.0.1:8080 | Frontend |
| http://127.0.0.1:8081/api/v1 | API |
| http://127.0.0.1:8081/docs | OpenAPI |

Running the backend on the host instead of in the container works too — the
local env file points at `127.0.0.1` for Mongo and Redis, which compose
overrides with in-network hostnames when the API runs as a container:

```sh
npm --prefix backend-node run start:local
```

---

## Preproduction and production

1. Resolve every `CHANGE_ME` from the secret manager into a `0600` file owned
   by the deploy user. See [docs/guides/secrets-management.md](docs/guides/secrets-management.md).
2. Pin `IMAGE_TAG` to an immutable release tag.
3. Set `CORS_ORIGINS` — production refuses to start without it.
4. Confirm `COOKIE_DOMAIN` matches the served domain, or the refresh cookie is
   silently dropped and every session ends after the access token expires.

```sh
./scripts/compose.sh production pull
./scripts/compose.sh production up -d
./scripts/compose.sh production exec backend npm run migrate
```

`autoIndex` is off in production, so index creation is a migration step rather
than something a deploy triggers under load.

---

## Adding a variable

1. Declare and validate it in `backend-node/config/index.js`.
2. Add it to `backend-node/.env.example` with a comment explaining it.
3. Add it to all three tier files.
4. Read it through `require('config')` — never `process.env`. ESLint enforces
   this, which is what keeps the configuration surface auditable.

If the value should be changeable without a redeploy, it is a **setting**, not
an environment variable. See
[docs/guides/module-authoring.md](docs/guides/module-authoring.md#settings).

---

## Health

| Endpoint | Meaning |
|---|---|
| `/healthz` | Process is alive. Touches no dependency. |
| `/readyz` | Can serve traffic. Fails on Mongo down; **not** on Redis down — a cache outage makes the API slower, not incorrect. |
