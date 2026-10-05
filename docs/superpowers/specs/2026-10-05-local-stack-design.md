# Local stack on docker compose — design

Date: 2026-10-05. Status: approved in conversation, pending spec review.
Amends: TRD §9.1 (Local environment), §10 (Testing), §12.2.

## 1. Goal

Run local development and the integration check on a `docker-compose.yml` the project owns, with real Postgres and
real Supabase Auth, instead of the Supabase CLI. The same command runs the integration check on the Mac and in CI.

What the user said:
- "lets focus on local dev build first, we will be utilizing postgres in local dev run and docker compose for proper
  integration check"
- Chose: lean Supabase stack (real Postgres image + real Auth), not plain Postgres with a fake login.
- Chose: both modes — hot-reload dev on the Mac against the stack, and a production-like integration check that runs
  the built app in a container.

Assumptions (correct me if wrong):
- Cloud deploy (M0 Task 17) waits until this is done; nothing here changes how production works.
- Local Supabase Studio is not needed; it can be added later as an optional container.
- Docker Desktop stays the only host requirement besides Node 22 and pnpm.

Success criteria:
1. `pnpm stack:up && pnpm dev` gives a working app at `http://localhost:5173`: sign in, save profile, import v1 data.
2. `pnpm stack:check` passes on the Mac from a clean state (`pnpm stack:reset` first): the built app image serves the
   web app and API at `http://localhost:3000`, and the integration tests and the Playwright e2e test pass against it.
3. CI runs `pnpm stack:check` and is green; the Supabase CLI is no longer used anywhere.
4. No secret value is committed; generated keys live only in gitignored files.

## 2. Services

```
                    ┌──────────── docker compose (always) ─────────────┐
 Mac browser ──────▶│ gateway (nginx) :54321                           │
   │                │   /auth/v1/*  ──▶ auth (gotrue v2.197.0) ─┐      │
   │                │                                           ▼      │
   │                │                      db (supabase/postgres 17.11) :54322
   │                │  migrate  (one-shot, after auth is healthy)      │
   │                │                                                  │
   ├─ :3000 ───────▶│ app (profile "app"): Vercel build output         │
   │                └──────────────────────────────────────────────────┘
   └─ daily dev: Vite :5173 + API :8787 on the Mac (hot reload) → gateway + db
```

| Service | Image | Host port | Role |
|---|---|---|---|
| `db` | `public.ecr.aws/supabase/postgres:17.11.0.002` | 54322 | Postgres with Supabase roles (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`) and `auth.uid()`. Named volume `db-data`. Healthcheck `pg_isready`. |
| `auth` | `public.ecr.aws/supabase/gotrue:v2.197.0` | — | Supabase Auth. Runs its own migrations into the `auth` schema on start. Healthcheck `GET /health`. |
| `gateway` | `nginx:1.27-alpine` | 54321 | Maps `/auth/v1/*` → `auth:9999/*` (prefix stripped), adds CORS for the two local web origins. Plays Kong's role so client and test URLs stay `http://localhost:54321/auth/v1/...`. |
| `migrate` | built from `docker/Dockerfile` (target `migrate`) | — | Runs `drizzle-kit migrate` once, after `auth` is healthy (our RLS migration references `auth.users`). Exits 0. |
| `app` | built from `docker/Dockerfile` (target `app`), profile `app` | 3000 | Serves `.vercel/output` exactly as built for Vercel: static files, `/api/*` → the bundled function, the headers and SPA fallback from `config.json`. |

The images for `db` and `auth` are the versions the Supabase CLI 2.119 already used for M0, so behaviour is unchanged.

`app` is on its own origin (`:3000`), separate from Auth (`:54321`), as in production (Vercel vs. Supabase), so CORS and
the CSP `connect-src` are exercised for real.

## 3. Auth configuration (replaces `supabase/config.toml`)

GoTrue environment, carrying over every M0 setting:

| Setting | Value | From |
|---|---|---|
| `GOTRUE_DISABLE_SIGNUP` | `true` | `[auth] enable_signup=false` (AUTH-3) |
| `GOTRUE_EXTERNAL_EMAIL_ENABLED` | `true` | `[auth.email] enable_signup=true` (email login must stay on) |
| `GOTRUE_MAILER_AUTOCONFIRM` | `true` | `enable_confirmations=false` |
| `GOTRUE_RATE_LIMIT_TOKEN_REFRESH` / sign-in limit | 150 / 300 per 5 min | `[auth.rate_limit]` |
| `GOTRUE_JWT_EXP` | 3600 | `jwt_expiry` |
| `GOTRUE_JWT_ISSUER` | `http://localhost:54321/auth/v1` | issuer the API checks |
| `GOTRUE_JWT_AUD` | `authenticated` | audience the API checks |
| `GOTRUE_JWT_KEYS` | ES256 private JWK (sign + verify) and an HS256 `oct` key (verify only) | §4 |
| `GOTRUE_JWT_SECRET` | the HS256 secret | §4 |
| `API_EXTERNAL_URL` | `http://localhost:54321/auth/v1` | |
| `GOTRUE_SITE_URL` | `http://localhost:5173` | |
| `GOTRUE_DB_DATABASE_URL` | `postgres://supabase_auth_admin:<pw>@db:5432/postgres` | |

User tokens are ES256 and their public key is served at `/auth/v1/.well-known/jwks.json`, the same as hosted Supabase.
The `anon` and `service_role` keys are HS256 tokens verified by the `oct` key, the same as the Supabase CLI.

## 4. Keys and environment files

- `pnpm stack:keys` (`scripts/stack-keys.mjs`, Node `crypto` only) writes `docker/.env.stack.local` once:
  `POSTGRES_PASSWORD`, `JWT_SECRET` (48 random bytes), `JWT_KEYS` (JSON), `ANON_KEY`, `SERVICE_ROLE_KEY` (HS256 JWTs
  with `role` `anon` / `service_role`, `iss` `supabase`, 10-year expiry, as the Supabase CLI issues them). It refuses to overwrite an
  existing file unless `--force`.
- The same script writes `.env.local` (replacing `scripts/test-env.mjs`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (`localhost:54322`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
  Keys are unchanged; only the generator changes.
- Both paths match the existing `.env*.local` ignore rule. A test asserts both are ignored.
- All values are local-only and are never used for the cloud project.

## 5. Code change: internal JWKS address

Inside the `app` container `localhost:54321` is the container itself, so the API cannot fetch the public keys from the
issuer address. Add an optional `SUPABASE_AUTH_INTERNAL_URL` to `loadConfig`:

- Issuer check unchanged: `${SUPABASE_URL}/auth/v1`.
- JWKS fetched from `${SUPABASE_AUTH_INTERNAL_URL ?? SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
- In compose, `app` sets it to `http://gateway:8000`. Production leaves it unset, so production behaviour is identical.
- Covered by `config.test.ts` (read when set, absent otherwise) and an auth unit test that a token whose issuer is the
  public URL verifies with keys fetched from the internal URL.

## 6. App image and the Vercel output server

`docker/Dockerfile`, multi-stage on `node:22-slim` with pnpm via corepack:

1. `deps`: `pnpm install --frozen-lockfile` with the workspace manifests.
2. `migrate` target: deps + `packages/db`; command `pnpm --filter @nri/db exec drizzle-kit migrate`.
3. `build`: copy source, run `pnpm build:vercel` with build args `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (so the CSP and the bundle use `http://localhost:54321`).
4. `app` target: `node:22-slim` with only `.vercel/output` and `scripts/serve-vercel-output.mjs`.

`scripts/serve-vercel-output.mjs` is a small Node `http` server that reads `.vercel/output/config.json` and applies
its routes in order: header routes, `/api/(.*)` → the default export of `functions/api.func/index.mjs`, filesystem
(static files under `static/`), then the SPA fallback. It has a `node:test` suite against a fixture output directory:
headers applied, `/api/health` dispatched to the function, static file served with its content type, unknown path
falls back to `index.html`, path traversal (`/../`) refused with 404.

## 7. Commands

| Command | Does |
|---|---|
| `pnpm stack:keys` | Generate `docker/.env.stack.local` and `.env.local` (once). |
| `pnpm stack:up` | `docker compose up -d --wait` for `db`, `auth`, `gateway`, `migrate`; runs `stack:keys` first if the file is missing. |
| `pnpm dev` | Unchanged: Vite + API on the Mac, against the stack. |
| `pnpm stack:check` | `stack:up`, then `docker compose --profile app up -d --build --wait app`, then `pnpm test:integration` and `pnpm test:e2e` with `E2E_BASE_URL=http://localhost:3000`. |
| `pnpm stack:down` | `docker compose --profile app down`. |
| `pnpm stack:reset` | `down -v` (wipes the database volume). |

`playwright.config.ts`: when `E2E_BASE_URL` is set, use it as `baseURL` and skip `webServer`; otherwise unchanged
(Vite on 5173).

## 8. CI

`.github/workflows/ci.yml` keeps install, typecheck, lint, unit, script tests and `build:vercel`. It replaces
`supabase start` / `test:env` / `db:migrate` / `test:integration` with `pnpm exec playwright install --with-deps chrome`
and `pnpm stack:check`. CI therefore gains the e2e test. On failure CI uploads `docker compose logs` and the Playwright
report as artifacts.

## 9. Removed

- `supabase` dev dependency, `supabase/` folder, `scripts/test-env.mjs`, the `test:env` script.
- TRD §9.1 Local row, §10 tool column, §12.2 updated to describe the compose stack.

## 10. Error handling

- `stack:up` fails loudly (non-zero) if any service is unhealthy after `--wait` (timeout 120 s) and prints
  `docker compose ps` plus the failing service's last 50 log lines.
- `stack:keys` refuses to overwrite without `--force`, since new keys invalidate every existing local session and
  the `anon` / `service_role` keys baked into an already-built `app` image.
- `gateway` returns 502 with nginx's default body if `auth` is down; the API already maps auth fetch failures (see the
  deferred minor about JWKS → 401) — unchanged by this work.

## 11. Testing

- Unit: `config.test.ts` and auth middleware test for §5.
- Scripts (`node:test`): `stack-keys` (writes both files, valid JWK set, `anon`/`service_role` JWTs verify with the
  secret, refuses overwrite, files are gitignored), `serve-vercel-output` (§6 cases).
- Integration: the existing 25 db/api integration tests, unchanged, pass against the compose stack.
- E2E: the existing smoke test passes against both Vite (`pnpm test:e2e`) and the built app (`stack:check`).

## 12. Risks proven first (Task 1 of the plan is a spike)

1. GoTrue v2.197.0 accepts the generated `GOTRUE_JWT_KEYS`, signs user tokens with ES256 and serves them at
   `/.well-known/jwks.json`; `anon`/`service_role` HS256 keys are accepted by the admin API.
2. The `supabase/postgres` image's built-in init is enough for GoTrue's migrations (roles, `auth` schema, passwords set
   from `POSTGRES_PASSWORD`) and for our `0001_rls.sql` (`auth.uid()`, `auth.users`, grants to `authenticated`).
3. GoTrue answers CORS preflight from `localhost:5173` and `localhost:3000` (else the gateway adds the headers).

If 1 or 2 fails, stop and report to the user before changing the design.
