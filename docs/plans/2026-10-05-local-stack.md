# Local Stack (docker compose) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase CLI with a project-owned docker compose stack (Supabase Postgres + Supabase Auth + an nginx gateway, plus the built app on :3000), so `pnpm stack:up && pnpm dev` is daily dev and `pnpm stack:check` is the integration check on the Mac and in CI.

**Architecture:** Compose runs `db` (supabase/postgres 17.11), `auth` (gotrue v2.197.0) and `gateway` (nginx, maps `/auth/v1/*` to Auth on `127.0.0.1:54321`). Keys are generated once by `scripts/stack-keys.mjs` into gitignored files. `scripts/stack.mjs` orchestrates up / check / down / reset; migrations run from the Mac. With `--profile app`, an image built from the exact Vercel build output is served by `scripts/serve-vercel-output.mjs` on `:3000`, and the existing integration and Playwright tests run against it. The API gains one optional setting, `SUPABASE_AUTH_INTERNAL_URL`, so it can fetch signing keys from inside Docker.

**Tech Stack:** Docker Compose v2, nginx 1.27-alpine, Node 22 (`node:crypto`, `node:http`, `node:test`), pnpm 11, Vitest 5, jose, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-05-local-stack-design.md` (amended §13). Product context: `docs/prd.md`, `docs/trd.md`.

## Global Constraints

- Images exactly: `public.ecr.aws/supabase/postgres:17.11.0.002`, `public.ecr.aws/supabase/gotrue:v2.197.0`, `nginx:1.27-alpine`, `node:22-slim`.
- Public Supabase URL and token issuer: `http://127.0.0.1:54321` and `http://127.0.0.1:54321/auth/v1`. Browser pages: `http://localhost:5173` (dev), `http://localhost:3000` (check).
- Host ports bind to `127.0.0.1` only: 54321 (gateway), 54322 (db), 3000 (app).
- No secret is committed. Generated files: `docker/.env.stack.local`, `.env.local` (both match the existing `.env*.local` ignore rule; mode 0600).
- The API never reads `SUPABASE_JWT_SECRET`; `.env.local` never contains it.
- Production behaviour is unchanged: `SUPABASE_AUTH_INTERNAL_URL` is unset on Vercel.
- Sign-in settings carried over from `supabase/config.toml`: sign-ups off, email login on, auto-confirm, `GOTRUE_RATE_LIMIT_OTP=300`, `GOTRUE_RATE_LIMIT_TOKEN_REFRESH=150`, JWT expiry 3600.
- Pushing to GitHub needs the user's explicit OK.

## Review Focus

1. Keys regenerated (`stack:keys --force`) while the old database volume still exists: `stack:up` must fail with a message that says to run `pnpm stack:reset`, not hang or half-work. Covered by the refusal message in Task 1 and the reset path in Task 3.
2. A request path that tries to escape `static/` (`/..%2fconfig.json`, `/../config.json`) on the :3000 server must never return a file outside `static/`. Covered in Task 5.
3. Browser sign-in from both page origins (`localhost:5173`, `localhost:3000`) to `127.0.0.1:54321` must pass CORS preflight. Covered by the spike in Task 2 and the e2e runs in Tasks 2 and 6.
4. A token whose issuer is the public URL must verify when the keys are fetched from the internal URL, and a token from any other issuer must still be rejected. Covered in Task 4.
5. `stack:check` must stop at the first failing step and print `docker compose ps` plus recent logs, so a failure is diagnosable from the output alone (CI included). Covered in Task 3 (`steps` order) and Task 8 (CI artifacts).

---

### Task 1: Local key generator (`pnpm stack:keys`)

**Files:**
- Create: `scripts/stack-keys.mjs`
- Test: `scripts/stack-keys.test.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `STACK_ENV = 'docker/.env.stack.local'`, `APP_ENV = '.env.local'`, `SUPABASE_URL = 'http://127.0.0.1:54321'`, `makeKeys(now?) → { POSTGRES_PASSWORD, JWT_SECRET, JWT_KEYS, ANON_KEY, SERVICE_ROLE_KEY }`, `appEnv(keys) → Record<string,string>`, `writeStackEnv({ root?, force? }) → keys` (throws if the stack file exists and `force` is false). CLI: `node scripts/stack-keys.mjs [--force]`.

- [ ] **Step 1: Write the failing tests**

`scripts/stack-keys.test.mjs`:

```js
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHmac, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { APP_ENV, STACK_ENV, writeStackEnv } from './stack-keys.mjs'

const parse = (text) =>
  Object.fromEntries(text.trim().split('\n').map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1).replace(/^'(.*)'$/, '$1')]
  }))
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
const hsValid = (jwt, secret) => {
  const [h, b, s] = jwt.split('.')
  return createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url') === s
}
function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'stack-keys-'))
  writeStackEnv({ root })
  const read = (f) => parse(readFileSync(join(root, f), 'utf8'))
  return { root, stack: read(STACK_ENV), app: read(APP_ENV) }
}

test('writes the stack env and a matching .env.local', () => {
  const { root, stack, app } = fresh()
  assert.deepEqual(Object.keys(stack).sort(), ['ANON_KEY', 'JWT_KEYS', 'JWT_SECRET', 'POSTGRES_PASSWORD', 'SERVICE_ROLE_KEY'])
  assert.equal(app.SUPABASE_URL, 'http://127.0.0.1:54321')
  assert.equal(app.VITE_SUPABASE_URL, app.SUPABASE_URL)
  assert.equal(app.SUPABASE_ANON_KEY, stack.ANON_KEY)
  assert.equal(app.VITE_SUPABASE_ANON_KEY, stack.ANON_KEY)
  assert.equal(app.SUPABASE_SERVICE_ROLE_KEY, stack.SERVICE_ROLE_KEY)
  assert.equal(app.DATABASE_URL, `postgresql://postgres:${stack.POSTGRES_PASSWORD}@127.0.0.1:54322/postgres`)
  assert.equal(app.SUPABASE_JWT_SECRET, undefined) // the API must never be handed the secret
  assert.equal(statSync(join(root, STACK_ENV)).mode & 0o077, 0)
  assert.equal(statSync(join(root, APP_ENV)).mode & 0o077, 0)
})

test('signs the anon and service_role keys with the secret Auth verifies them with', () => {
  const { stack } = fresh()
  for (const [key, role] of [[stack.ANON_KEY, 'anon'], [stack.SERVICE_ROLE_KEY, 'service_role']]) {
    assert.ok(hsValid(key, stack.JWT_SECRET), `${role} key signature`)
    assert.equal(claims(key).role, role)
    assert.ok(claims(key).exp > Date.now() / 1000 + 365 * 24 * 3600, `${role} key lasts years, not hours`)
  }
})

test('JWT_KEYS holds one ES256 signing key whose signatures verify', () => {
  const { stack } = fresh()
  const keys = JSON.parse(stack.JWT_KEYS)
  assert.equal(keys.length, 1)
  const [k] = keys
  assert.equal(k.alg, 'ES256')
  assert.equal(k.crv, 'P-256')
  assert.deepEqual(k.key_ops, ['sign', 'verify'])
  assert.ok(k.kid && k.d)
  const priv = createPrivateKey({ key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y, d: k.d }, format: 'jwk' })
  const sig = sign('sha256', Buffer.from('x'), priv)
  assert.ok(verify('sha256', Buffer.from('x'), createPublicKey(priv), sig))
})

test('refuses to replace existing keys unless forced, and says how to recover', () => {
  const { root } = fresh()
  const before = readFileSync(join(root, STACK_ENV), 'utf8')
  assert.throws(() => writeStackEnv({ root }), /already exists[\s\S]*stack:reset/)
  assert.equal(readFileSync(join(root, STACK_ENV), 'utf8'), before)
  writeStackEnv({ root, force: true })
  assert.notEqual(readFileSync(join(root, STACK_ENV), 'utf8'), before)
})

test('both generated files are gitignored in this repo', () => {
  for (const f of [STACK_ENV, APP_ENV]) execFileSync('git', ['check-ignore', '-q', f]) // throws if not ignored
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/stack-keys.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/stack-keys.mjs'`.

- [ ] **Step 3: Implement**

`scripts/stack-keys.mjs`:

```js
// Generates the local-only keys for the docker compose stack, and the .env.local the app and tests read.
// None of these values are used anywhere but this machine (or a CI runner).
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const STACK_ENV = 'docker/.env.stack.local'
export const APP_ENV = '.env.local'
// Same host the Supabase CLI used; the API compares the token issuer against this exact string.
export const SUPABASE_URL = 'http://127.0.0.1:54321'

const b64url = (v) => Buffer.from(v).toString('base64url')

function signHs256(payload, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
}

export function makeKeys(now = Math.floor(Date.now() / 1000)) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  // Auth signs user tokens with this key and publishes its public half at /auth/v1/.well-known/jwks.json.
  const signing = { ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), use: 'sig', key_ops: ['sign', 'verify'], alg: 'ES256', ext: true }
  const jwtSecret = randomBytes(48).toString('base64url')
  const exp = now + 10 * 365 * 24 * 3600
  const roleKey = (role) => signHs256({ iss: 'supabase', ref: 'local', role, iat: now, exp }, jwtSecret)
  return {
    POSTGRES_PASSWORD: randomBytes(24).toString('base64url'),
    JWT_SECRET: jwtSecret,
    JWT_KEYS: JSON.stringify([signing]),
    ANON_KEY: roleKey('anon'),
    SERVICE_ROLE_KEY: roleKey('service_role'),
  }
}

export function appEnv(keys) {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: keys.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: keys.SERVICE_ROLE_KEY,
    DATABASE_URL: `postgresql://postgres:${keys.POSTGRES_PASSWORD}@127.0.0.1:54322/postgres`,
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: keys.ANON_KEY,
  }
}

// Single quotes keep JSON values literal for docker compose, Node's loadEnvFile and Vite's dotenv alike.
const dotenv = (o) => Object.entries(o).map(([k, v]) => `${k}=${v.includes('"') ? `'${v}'` : v}`).join('\n') + '\n'

export function writeStackEnv({ root = process.cwd(), force = false } = {}) {
  const stackPath = join(root, STACK_ENV)
  if (existsSync(stackPath) && !force) {
    throw new Error(
      `${STACK_ENV} already exists. New keys sign out every session and do not match the existing database:\n` +
        'run "pnpm stack:reset", then "pnpm stack:keys --force".',
    )
  }
  const keys = makeKeys()
  mkdirSync(dirname(stackPath), { recursive: true })
  writeFileSync(stackPath, dotenv(keys), { mode: 0o600 })
  writeFileSync(join(root, APP_ENV), dotenv(appEnv(keys)), { mode: 0o600 })
  return keys
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    writeStackEnv({ force: process.argv.includes('--force') })
    console.log(`wrote ${STACK_ENV} and ${APP_ENV}`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
```

Note: `writeFileSync`'s `mode` only applies when it creates the file. An existing `.env.local` (from the old CLI flow) keeps its mode, so delete it before the first run in Step 5.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/stack-keys.test.mjs`
Expected: PASS — `# pass 5`, `# fail 0`.

- [ ] **Step 5: Add the script, generate real keys, run all script tests**

In `package.json` scripts add `"stack:keys": "node scripts/stack-keys.mjs",` (keep `test:env` until Task 3).

Run: `rm -f .env.local && pnpm stack:keys && pnpm test:scripts`
Expected: `wrote docker/.env.stack.local and .env.local`, then all script tests pass (`# fail 0`).

- [ ] **Step 6: Commit**

```bash
git add scripts/stack-keys.mjs scripts/stack-keys.test.mjs package.json
git commit -m "feat(stack): generate local Auth keys and .env.local for the compose stack"
```

---

### Task 2: Compose infrastructure + spike (db, auth, gateway)

This task proves the spec's §12 risks. **If Step 4 or Step 6 fails after following the listed fallback, stop and report to the user; do not redesign.**

**Files:**
- Create: `docker-compose.yml`, `docker/db/schema.sql`, `docker/gateway/nginx.conf`

**Interfaces:**
- Consumes: `docker/.env.stack.local` (Task 1).
- Produces: compose services `db`, `auth`, `gateway`; host ports `127.0.0.1:54322` (Postgres, user `postgres`), `127.0.0.1:54321` (`/auth/v1/*`). Docker-network names `db:5432`, `auth:9999`, `gateway:8000`.

- [ ] **Step 1: Stop the Supabase CLI stack (frees ports 54321/54322; its data volume is kept)**

Run: `pnpm exec supabase stop`
Expected: `Stopped supabase local development setup.` and `docker ps --format '{{.Names}}' | grep -c supabase_` prints `0`.

- [ ] **Step 2: Write the compose file and its two support files**

`docker-compose.yml`:

```yaml
# Local stack: the Postgres and Auth images the Supabase CLI 2.119 ran, an nginx gateway in Kong's place for
# /auth/v1, and (with --profile app, Task 6) the production build on :3000.
# Values come from docker/.env.stack.local, written by `pnpm stack:keys`. Host ports bind to 127.0.0.1 only.
name: nri-finance

services:
  db:
    image: public.ecr.aws/supabase/postgres:17.11.0.002
    command: ["postgres", "-D", "/etc/postgresql"]
    environment:
      POSTGRES_USER: supabase_admin
      POSTGRES_DB: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_HOST: /var/run/postgresql
      POSTGRES_INITDB_ARGS: --allow-group-access --locale-provider=icu --encoding=UTF-8 --icu-locale=en_US.UTF-8
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXP: 3600
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./docker/db/schema.sql:/etc/postgresql.schema.sql:ro
    ports: ["127.0.0.1:54322:5432"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]
      interval: 2s
      timeout: 2s
      retries: 60

  auth:
    image: public.ecr.aws/supabase/gotrue:v2.197.0
    depends_on:
      db: { condition: service_healthy }
    environment:
      API_EXTERNAL_URL: http://127.0.0.1:54321/auth/v1
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgresql://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/postgres
      GOTRUE_DB_MIGRATIONS_PATH: /usr/local/etc/auth/migrations
      GOTRUE_SITE_URL: http://localhost:5173
      GOTRUE_URI_ALLOW_LIST: http://localhost:5173,http://localhost:3000
      GOTRUE_DISABLE_SIGNUP: "true" # AUTH-3: only accounts created by an admin can sign in
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true" # email + password sign-in must stay on
      GOTRUE_MAILER_AUTOCONFIRM: "true"
      GOTRUE_EXTERNAL_PHONE_ENABLED: "false"
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: "false"
      GOTRUE_JWT_ISSUER: http://127.0.0.1:54321/auth/v1
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_EXP: 3600
      GOTRUE_JWT_SECRET: ${JWT_SECRET} # verifies the HS256 anon / service_role keys
      GOTRUE_JWT_KEYS: ${JWT_KEYS} # ES256 key that signs user tokens (published as JWKS)
      GOTRUE_JWT_VALID_METHODS: HS256,ES256
      GOTRUE_RATE_LIMIT_OTP: 300 # sign-ins + sign-ups per 5 min; tests sign in many fresh users
      GOTRUE_RATE_LIMIT_TOKEN_REFRESH: 150
      GOTRUE_RATE_LIMIT_VERIFY: 30
      GOTRUE_RATE_LIMIT_EMAIL_SENT: 360000
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true"
      GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: 10
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:9999/health"]
      interval: 2s
      timeout: 2s
      retries: 60

  gateway:
    image: nginx:1.27-alpine
    depends_on:
      auth: { condition: service_healthy }
    volumes:
      - ./docker/gateway/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports: ["127.0.0.1:54321:8000"]
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:8000/auth/v1/health"]
      interval: 2s
      timeout: 2s
      retries: 30

volumes:
  db-data:
```

`docker/db/schema.sql`:

```sql
-- Runs once, when the supabase/postgres image initialises an empty volume (it executes /etc/postgresql.schema.sql).
-- Same as the Supabase CLI: the login roles our services use get the generated local password.
\set pgpass `echo "$PGPASSWORD"`
ALTER USER postgres WITH PASSWORD :'pgpass';
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
```

`docker/gateway/nginx.conf`:

```nginx
# Stands in for Supabase's Kong gateway for the one service we run: /auth/v1/* goes to Auth with the prefix stripped,
# so the browser, supabase-js and the test helpers use the same URLs as against hosted Supabase.
server {
  listen 8000;

  location /auth/v1/ {
    proxy_pass http://auth:9999/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    return 404;
  }
}
```

- [ ] **Step 3: Start the infrastructure**

Run: `docker compose --env-file docker/.env.stack.local up -d --wait --wait-timeout 180 db auth gateway && docker compose --env-file docker/.env.stack.local ps --format '{{.Service}} {{.Health}}'`
Expected: three lines `db healthy`, `auth healthy`, `gateway healthy`.
If `auth` is unhealthy: `docker compose --env-file docker/.env.stack.local logs auth --tail 40`. A password error means `schema.sql` did not run (check the volume was empty: `docker compose ... down -v` and retry once). Any other error: stop and report.

- [ ] **Step 4: Spike check 1 — Auth publishes the ES256 key, public half only**

Run: `curl -s http://127.0.0.1:54321/auth/v1/.well-known/jwks.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {keys}=JSON.parse(s);console.log(keys.length, keys[0].alg, keys[0].kty, "d" in keys[0])})'`
Expected: `1 ES256 EC false`.

- [ ] **Step 5: Apply migrations from the Mac**

Run: `pnpm db:migrate`
Expected: drizzle-kit reports the migrations applied with no error (`0000_init`, `0001_rls`, `0002_profile_rate_positive`).

- [ ] **Step 6: Spike check 2 — CORS preflight from both page origins**

Run (twice, with `ORIGIN=http://localhost:5173` and `ORIGIN=http://localhost:3000`):
`curl -s -o /dev/null -D - -X OPTIONS 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: apikey,authorization,content-type,x-client-info,x-supabase-api-version' | grep -i '^access-control-allow-origin'`
Expected: an `access-control-allow-origin` line naming the origin (or `*`) for both.
Fallback if missing: add these lines inside `location /auth/v1/ { … }` in `docker/gateway/nginx.conf`, run `docker compose --env-file docker/.env.stack.local restart gateway`, and repeat this step. Ledger the ruling.

```nginx
    if ($request_method = OPTIONS) {
      add_header Access-Control-Allow-Origin $http_origin always;
      add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
      add_header Access-Control-Allow-Headers $http_access_control_request_headers always;
      add_header Access-Control-Max-Age 3600 always;
      return 204;
    }
    proxy_hide_header Access-Control-Allow-Origin;
    add_header Access-Control-Allow-Origin $http_origin always;
    add_header Vary Origin always;
```

- [ ] **Step 7: Spike check 3 — the whole existing integration suite passes on the new stack**

This exercises the admin API with the service key, password sign-in returning ES256 tokens the API verifies via JWKS, sign-up refused (`signup_disabled`), and RLS against `auth.uid()` / `auth.users`.

Run: `pnpm test:integration 2>&1 | tail -15`
Expected: `packages/db` 6 passed, `apps/api` 19 passed, 0 failed.

- [ ] **Step 8: Spike check 4 — dev-mode e2e (Vite on :5173 against the stack)**

Run: `pnpm test:e2e`
Expected: `1 passed`.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml docker/db/schema.sql docker/gateway/nginx.conf
git commit -m "feat(stack): docker compose with Supabase Postgres, Auth and an nginx gateway"
```

---

### Task 3: Stack commands; retire the Supabase CLI

**Files:**
- Create: `scripts/stack.mjs`, `scripts/stack.test.mjs`
- Modify: `package.json`, `packages/test-utils/src/index.ts:5`
- Delete: `scripts/test-env.mjs`, `supabase/` (whole folder), the `supabase` devDependency

**Interfaces:**
- Consumes: `STACK_ENV`, `writeStackEnv` (Task 1); compose services (Task 2).
- Produces: `steps(cmd) → Array<{ cmd: string[], env?: Record<string,string> }>` for `up | check | down | reset`; `E2E_BASE_URL = 'http://localhost:3000'`. Root scripts `stack:up`, `stack:check`, `stack:down`, `stack:reset`. (`check` references the `app` service that Task 6 adds; it is not run until then.)

- [ ] **Step 1: Write the failing tests**

`scripts/stack.test.mjs`:

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { E2E_BASE_URL, steps } from './stack.mjs'

const lines = (cmd) => steps(cmd).map((s) => s.cmd.join(' '))

test('up starts the infrastructure, waits for health, then migrates from the Mac', () => {
  const s = lines('up')
  assert.equal(s.length, 2)
  assert.match(s[0], /^docker compose( --env-file \S+)? up -d --wait --wait-timeout \d+ db auth gateway$/)
  assert.equal(s[1], 'pnpm db:migrate')
})

test('check = up, then build and start the app, then integration and e2e against :3000', () => {
  const s = steps('check')
  assert.deepEqual(s.slice(0, 2), steps('up'))
  assert.match(s[2].cmd.join(' '), /--profile app up -d --build --wait --wait-timeout \d+ app$/)
  assert.equal(s[3].cmd.join(' '), 'pnpm test:integration')
  assert.equal(s[4].cmd.join(' '), 'pnpm test:e2e')
  assert.deepEqual(s[4].env, { E2E_BASE_URL })
  assert.equal(E2E_BASE_URL, 'http://localhost:3000')
  assert.equal(s.length, 5)
})

test('down keeps the database volume; reset removes it', () => {
  assert.match(lines('down')[0], /--profile app down$/)
  assert.match(lines('reset')[0], /--profile app down -v$/)
})

test('unknown commands are refused with the valid list', () => {
  assert.throws(() => steps('nope'), /unknown command "nope".*up, check, down, reset/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/stack.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/stack.mjs'`.

- [ ] **Step 3: Implement**

`scripts/stack.mjs`:

```js
// One entry point for the local docker compose stack:
//   pnpm stack:up | stack:check | stack:down | stack:reset
// Stops at the first failing step; on a failure it prints `docker compose ps` and recent logs.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STACK_ENV, writeStackEnv } from './stack-keys.mjs'

export const E2E_BASE_URL = 'http://localhost:3000'
const INFRA = ['db', 'auth', 'gateway']
// Without the env file (fresh clone, before `up`), `down` / `reset` must still work.
const compose = () => ['docker', 'compose', ...(existsSync(STACK_ENV) ? ['--env-file', STACK_ENV] : [])]

export function steps(cmd) {
  switch (cmd) {
    case 'up':
      return [
        { cmd: [...compose(), 'up', '-d', '--wait', '--wait-timeout', '180', ...INFRA] },
        // Our RLS migration references auth.users, which Auth creates on start, so this runs after `--wait`.
        { cmd: ['pnpm', 'db:migrate'] },
      ]
    case 'check':
      return [
        ...steps('up'),
        { cmd: [...compose(), '--profile', 'app', 'up', '-d', '--build', '--wait', '--wait-timeout', '300', 'app'] },
        { cmd: ['pnpm', 'test:integration'] },
        { cmd: ['pnpm', 'test:e2e'], env: { E2E_BASE_URL } },
      ]
    case 'down':
      return [{ cmd: [...compose(), '--profile', 'app', 'down'] }]
    case 'reset':
      return [{ cmd: [...compose(), '--profile', 'app', 'down', '-v'] }]
    default:
      throw new Error(`unknown command "${cmd}" (use up, check, down, reset)`)
  }
}

function run({ cmd, env }) {
  console.log(`\n$ ${cmd.join(' ')}`)
  return spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...env } }).status === 0
}

function diagnose() {
  const c = compose()
  spawnSync(c[0], [...c.slice(1), '--profile', 'app', 'ps', '-a'], { stdio: 'inherit' })
  spawnSync(c[0], [...c.slice(1), '--profile', 'app', 'logs', '--tail', '50'], { stdio: 'inherit' })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2]
  try {
    if ((cmd === 'up' || cmd === 'check') && !existsSync(STACK_ENV)) {
      writeStackEnv()
      console.log(`generated ${STACK_ENV} and .env.local`)
    }
    for (const step of steps(cmd)) {
      if (!run(step)) {
        if (cmd === 'up' || cmd === 'check') diagnose()
        console.error(`\nstack:${cmd} failed at: ${step.cmd.join(' ')}`)
        process.exit(1)
      }
    }
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test scripts/stack.test.mjs`
Expected: PASS — `# pass 4`, `# fail 0`.

- [ ] **Step 5: Wire scripts; remove the CLI**

`package.json` scripts: delete `"test:env"`; add

```json
"stack:up": "node scripts/stack.mjs up",
"stack:check": "node scripts/stack.mjs check",
"stack:down": "node scripts/stack.mjs down",
"stack:reset": "node scripts/stack.mjs reset",
```

`packages/test-utils/src/index.ts` line 5 becomes:

```ts
  if (!v) throw new Error(`${k} missing — run "pnpm stack:up" (it writes .env.local)`)
```

Run: `git rm -r -q supabase scripts/test-env.mjs && pnpm remove -w supabase`
Expected: `supabase` gone from `package.json` devDependencies and `pnpm-lock.yaml` updated.

Check nothing still refers to them: `grep -rn "test:env\|supabase start\|supabase status\|test-env.mjs" --include='*.ts' --include='*.mjs' --include='*.json' --include='*.yml' . | grep -v node_modules | grep -v '^./docs/plans/2026-10-02\|^./legacy\|^./.superpowers'`
Expected: matches only in `.github/workflows/ci.yml` (fixed in Task 8).

- [ ] **Step 6: Prove the commands end to end**

Run: `pnpm stack:reset && pnpm stack:up && pnpm test:integration 2>&1 | tail -6`
Expected: reset removes containers and the `nri-finance_db-data` volume; up prints three healthy services, then migrations applied; integration 25 passed.

Run: `pnpm stack:down && docker volume ls --format '{{.Name}}' | grep -c nri-finance_db-data`
Expected: `1` (down keeps the data). Then `pnpm stack:up` again (fast; migrations already applied).

- [ ] **Step 7: Commit**

```bash
git add -A scripts/stack.mjs scripts/stack.test.mjs package.json pnpm-lock.yaml packages/test-utils/src/index.ts
git commit -m "feat(stack): stack:up/check/down/reset; remove the Supabase CLI"
```

(`git rm` in Step 5 already staged the deletions.)

---

### Task 4: API — fetch signing keys from `SUPABASE_AUTH_INTERNAL_URL`

**Files:**
- Modify: `apps/api/src/config.ts`, `apps/api/src/middleware/auth.ts`
- Test: `apps/api/test/config.test.ts` (add), `apps/api/test/auth.jwks.test.ts` (create)

**Interfaces:**
- Produces: `Config.authInternalUrl?: string` read from `SUPABASE_AUTH_INTERNAL_URL` (trailing `/` trimmed). JWKS URL = `${authInternalUrl ?? supabaseUrl}/auth/v1/.well-known/jwks.json`; issuer stays `${supabaseUrl}/auth/v1`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/config.test.ts`:

```ts
it('reads SUPABASE_AUTH_INTERNAL_URL, used only inside Docker to reach Auth', () => {
  const c = loadConfig({ SUPABASE_URL: 'http://127.0.0.1:54321', DATABASE_URL: 'postgres://x', SUPABASE_AUTH_INTERNAL_URL: 'http://gateway:8000/' })
  expect(c.authInternalUrl).toBe('http://gateway:8000')
  expect(c.supabaseUrl).toBe('http://127.0.0.1:54321')
})

it('leaves the internal URL unset in production', () => {
  expect(loadConfig({ SUPABASE_URL: 'https://x.supabase.co', DATABASE_URL: 'postgres://x' }).authInternalUrl).toBeUndefined()
})
```

Create `apps/api/test/auth.jwks.test.ts`:

```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Hono } from 'hono'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { Config } from '../src/config'
import { toErrorResponse } from '../src/errors'
import { authMiddleware, type AuthVars } from '../src/middleware/auth'

// What tokens name as issuer. Unreachable from here, just as 127.0.0.1:54321 is unreachable inside the app container.
const publicUrl = 'http://supabase.public.invalid:54321'
let server: Server
let internalUrl: string
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let requested = ''

beforeAll(async () => {
  const pair = await generateKeyPair('ES256')
  privateKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
  server = createServer((req, res) => {
    requested = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  internalUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const token = () =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject('22222222-2222-2222-2222-222222222222')
    .setIssuer(`${publicUrl}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime('5m')
    .sign(privateKey)

async function call(config: Config) {
  const app = new Hono<{ Variables: AuthVars }>()
  app.onError((e, c) => { const r = toErrorResponse(e); return c.json(r.body, r.status) })
  app.use('/api/*', authMiddleware(config))
  app.get('/api/whoami', (c) => c.json({ userId: c.var.userId }))
  return app.request('/api/whoami', { headers: { authorization: `Bearer ${await token()}` } })
}

it('fetches keys from the internal URL and still checks the public issuer', async () => {
  const res = await call({ supabaseUrl: publicUrl, authInternalUrl: internalUrl, databaseUrl: 'x' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ userId: '22222222-2222-2222-2222-222222222222' })
  expect(requested).toBe('/auth/v1/.well-known/jwks.json')
})

it('rejects a token whose issuer is not this project, even though the key verifies', async () => {
  const res = await call({ supabaseUrl: 'http://another.invalid:54321', authInternalUrl: internalUrl, databaseUrl: 'x' })
  expect(res.status).toBe(401)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @nri/api exec vitest run --project unit test/config.test.ts test/auth.jwks.test.ts`
Expected: FAIL — `authInternalUrl` is `undefined` (expected `'http://gateway:8000'`), and the first JWKS test gets 401 (keys fetched from the unreachable public URL). The "production" and "another issuer" tests pass already; that is expected.

- [ ] **Step 3: Implement**

`apps/api/src/config.ts`:

```ts
/**
 * `jwtSecret` is only ever set by unit tests constructing a Config directly; real deployments verify via JWKS.
 * `authInternalUrl` is only set inside docker compose, where the public Supabase URL points at the container itself.
 */
export type Config = { supabaseUrl: string; authInternalUrl?: string; jwtSecret?: string; databaseUrl: string }

export function loadConfig(env: Record<string, string | undefined>): Config {
  const supabaseUrl = env.SUPABASE_URL
  const databaseUrl = env.DATABASE_URL
  if (!supabaseUrl || !databaseUrl) throw new Error('SUPABASE_URL and DATABASE_URL must be set')
  // SUPABASE_JWT_SECRET is deliberately not read: if it were set by mistake, HS256-only verification
  // would reject every real (ES256) Supabase token and nobody could sign in.
  const authInternalUrl = env.SUPABASE_AUTH_INTERNAL_URL?.replace(/\/$/, '')
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), databaseUrl, ...(authInternalUrl ? { authInternalUrl } : {}) }
}
```

`apps/api/src/middleware/auth.ts` — replace the `key` declaration:

```ts
  const issuer = `${config.supabaseUrl}/auth/v1`
  // Supabase Auth (local stack and hosted) signs ES256 tokens and publishes the keys at the JWKS URL. Inside docker
  // compose the keys are fetched via the internal address; the issuer check always uses the public URL.
  // A shared HS256 secret is only used by unit tests that mint their own tokens.
  const key: Uint8Array | JWTVerifyGetKey = config.jwtSecret
    ? new TextEncoder().encode(config.jwtSecret)
    : createRemoteJWKSet(new URL(`${config.authInternalUrl ?? config.supabaseUrl}/auth/v1/.well-known/jwks.json`))
```

- [ ] **Step 4: Run to verify pass, then the API suites**

Run: `pnpm --filter @nri/api test && pnpm --filter @nri/api test:int && pnpm --filter @nri/api typecheck`
Expected: unit 30 passed (26 + 4 new), int 19 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/middleware/auth.ts apps/api/test/config.test.ts apps/api/test/auth.jwks.test.ts
git commit -m "feat(api): optional SUPABASE_AUTH_INTERNAL_URL for fetching JWKS inside Docker"
```

---

### Task 5: Vercel-output server for :3000

**Files:**
- Create: `scripts/serve-vercel-output.mjs`, `scripts/serve-vercel-output.test.mjs`
- Modify: `scripts/vercel-headers.mjs` (add `outputConfig`), `scripts/vercel-build.mjs` (use it)

**Interfaces:**
- Produces: `outputConfig(headers) → { version: 3, routes }` (the routes `vercel-build.mjs` writes, now shared with the test); `createOutputServer(outputDir) → http.Server`. CLI: `node serve-vercel-output.mjs <outputDir>` listens on `$PORT` (default 3000), `0.0.0.0`.

- [ ] **Step 1: Write the failing tests**

`scripts/serve-vercel-output.test.mjs`:

```js
import assert from 'node:assert/strict'
import { get } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createOutputServer } from './serve-vercel-output.mjs'
import { outputConfig } from './vercel-headers.mjs'

let server
let port
before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'vc-out-'))
  mkdirSync(join(root, 'static/assets'), { recursive: true })
  writeFileSync(join(root, 'static/index.html'), '<!doctype html><p>app shell</p>')
  writeFileSync(join(root, 'static/assets/app.js'), 'console.log(1)')
  mkdirSync(join(root, 'functions/api.func'), { recursive: true })
  writeFileSync(
    join(root, 'functions/api.func/index.mjs'),
    "export default (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ fn: 'api', url: req.url })) }",
  )
  writeFileSync(join(root, 'config.json'), JSON.stringify(outputConfig({ 'X-Test': 'on-every-response' })))
  server = createOutputServer(root)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})
after(() => new Promise((resolve) => server.close(resolve)))

// Raw path on the wire (fetch would normalise "/../" before sending).
const req = (path) =>
  new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    }).on('error', reject)
  })

test('sends /api/* to the bundled function with the original URL', async () => {
  const r = await req('/api/me?x=1')
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.body), { fn: 'api', url: '/api/me?x=1' })
})

test('serves static files with their content type', async () => {
  const r = await req('/assets/app.js')
  assert.equal(r.status, 200)
  assert.match(r.headers['content-type'], /^text\/javascript/)
  assert.equal(r.body, 'console.log(1)')
})

test('falls back to index.html for client routes', async () => {
  const r = await req('/settings')
  assert.equal(r.status, 200)
  assert.match(r.headers['content-type'], /^text\/html/)
  assert.match(r.body, /app shell/)
})

test('applies the header routes to every kind of response', async () => {
  for (const p of ['/api/me', '/assets/app.js', '/settings']) assert.equal((await req(p)).headers['x-test'], 'on-every-response', p)
})

test('never serves a file outside static/', async () => {
  const plain = await req('/../config.json')
  assert.doesNotMatch(plain.body, /"routes"/)
  const encoded = await req('/..%2fconfig.json')
  assert.equal(encoded.status, 404)
  assert.doesNotMatch(encoded.body, /"routes"/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/serve-vercel-output.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/serve-vercel-output.mjs'` (and `outputConfig` is not exported yet).

- [ ] **Step 3: Implement**

Append to `scripts/vercel-headers.mjs`:

```js
/** Build Output API v3 config: security headers on everything, /api/* to the function, static files, SPA fallback. */
export function outputConfig(headers) {
  return {
    version: 3,
    routes: [
      { src: '/(.*)', headers, continue: true },
      { src: '/api/(.*)', dest: '/api' },
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
  }
}
```

In `scripts/vercel-build.mjs`: change the import to `import { outputConfig, securityHeaders } from './vercel-headers.mjs'` and replace the final `writeFileSync(`${out}/config.json`, …)` call with:

```js
writeFileSync(`${out}/config.json`, JSON.stringify(outputConfig(headers), null, 2))
```

`scripts/serve-vercel-output.mjs`:

```js
// Serves a Vercel Build Output API v3 directory the way Vercel routes it, for the local integration check:
// header routes, /api/* to the bundled function, files under static/, then the SPA fallback.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
}

export function createOutputServer(outputDir) {
  const root = resolve(outputDir)
  const staticDir = join(root, 'static')
  const routes = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).routes.map((r) => ({
    ...r,
    re: r.src ? new RegExp(`^${r.src}$`) : null,
  }))
  const handlers = new Map()
  const fnDir = (dest) => join(root, 'functions', `${dest.replace(/^\//, '')}.func`)
  const handler = async (dest) => {
    if (!handlers.has(dest)) handlers.set(dest, (await import(pathToFileURL(join(fnDir(dest), 'index.mjs')).href)).default)
    return handlers.get(dest)
  }
  // Resolves a URL path to a file inside static/, or null. Never returns a path outside static/.
  const staticFile = (p) => {
    const file = resolve(staticDir, `.${p}`)
    if (file !== staticDir && !file.startsWith(staticDir + sep)) return null
    return existsSync(file) && statSync(file).isFile() ? file : null
  }
  const send = (res, file) => {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  }

  return createServer(async (req, res) => {
    try {
      let path
      try {
        path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
      } catch {
        res.writeHead(400).end()
        return
      }
      if (path.split('/').includes('..')) {
        res.writeHead(404).end()
        return
      }
      for (const route of routes) {
        if (route.handle === 'filesystem') {
          const file = staticFile(path)
          if (file) return send(res, file)
          continue
        }
        if (!route.re?.test(path)) continue
        for (const [k, v] of Object.entries(route.headers ?? {})) res.setHeader(k, v)
        if (route.continue || !route.dest) continue
        if (existsSync(fnDir(route.dest))) return await (await handler(route.dest))(req, res)
        const file = staticFile(route.dest)
        if (file) return send(res, file)
      }
      res.writeHead(404).end()
    } catch (e) {
      console.error(e)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '.vercel/output'
  const port = Number(process.env.PORT ?? 3000)
  createOutputServer(dir).listen(port, '0.0.0.0', () => console.log(`serving ${dir} on :${port}`))
}
```

- [ ] **Step 4: Run to verify pass, and that the real build still produces the same config**

Run: `pnpm test:scripts && pnpm build:vercel >/dev/null && node -e 'const c=require("./.vercel/output/config.json");console.log(c.routes.length, c.routes[1].dest, Object.keys(c.routes[0].headers).length)'`
Expected: all script tests pass (`# fail 0`); then `4 /api 4`.

- [ ] **Step 5: Serve the real build locally (smoke)**

Run: `PORT=3100 SUPABASE_URL=http://127.0.0.1:54321 DATABASE_URL="$(grep ^DATABASE_URL= .env.local | cut -d= -f2-)" node scripts/serve-vercel-output.mjs .vercel/output & sleep 1; curl -s localhost:3100/api/health; curl -sI localhost:3100/settings | grep -i '^content-security-policy'; kill %1`
Expected: `{"ok":true}`, then a CSP line containing `connect-src 'self' http://127.0.0.1:54321`.

- [ ] **Step 6: Commit**

```bash
git add scripts/serve-vercel-output.mjs scripts/serve-vercel-output.test.mjs scripts/vercel-headers.mjs scripts/vercel-build.mjs
git commit -m "feat(stack): serve the Vercel build output locally with Vercel's routing"
```

---

### Task 6: App image, `stack:check`, Playwright against :3000

**Files:**
- Create: `docker/app.Dockerfile`, `.dockerignore`
- Modify: `docker-compose.yml` (add `app`), `playwright.config.ts`

**Interfaces:**
- Consumes: `serve-vercel-output.mjs` (Task 5), `authInternalUrl` (Task 4), `steps('check')` (Task 3), `ANON_KEY` / `POSTGRES_PASSWORD` from the stack env (Task 1).
- Produces: compose service `app` (profile `app`) on `127.0.0.1:3000`; Playwright honours `E2E_BASE_URL`.

- [ ] **Step 1: Write the failing check**

The check is the command itself. Run: `pnpm stack:check`
Expected: FAIL at the third step with `no such service: app` (or `service "app" ... not found`), followed by the `ps` / logs diagnosis — proving `stack:check` stops at the first failing step.

- [ ] **Step 2: Add the image, the ignore file and the service**

`.dockerignore`:

```
**/node_modules
**/dist
.git
.vercel
.env*
**/.env*
.superpowers
.claude
playwright-report
test-results
.e2e-user.json
legacy/finance-data.json
legacy/finance-backup-*.json
```

`docker/app.Dockerfile`:

```dockerfile
# Production-like app image for the local integration check: the exact Vercel build output,
# served on :3000 by scripts/serve-vercel-output.mjs with Vercel's routing and headers.
FROM node:22-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@latest && corepack enable
WORKDIR /repo
# Manifests first, so the install layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/test-utils/package.json packages/test-utils/
RUN pnpm install --frozen-lockfile
COPY . .
# The browser bundle embeds these, and the CSP is derived from the URL; both are public values.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN pnpm build:vercel

FROM node:22-slim
WORKDIR /app
COPY --from=build /repo/.vercel/output ./output
COPY scripts/serve-vercel-output.mjs ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "serve-vercel-output.mjs", "output"]
```

Append to `services:` in `docker-compose.yml` (before `volumes:`):

```yaml
  app:
    profiles: [app]
    build:
      context: .
      dockerfile: docker/app.Dockerfile
      args:
        VITE_SUPABASE_URL: http://127.0.0.1:54321
        VITE_SUPABASE_ANON_KEY: ${ANON_KEY}
    depends_on:
      db: { condition: service_healthy }
      gateway: { condition: service_healthy }
    environment:
      SUPABASE_URL: http://127.0.0.1:54321 # the issuer in every token, as the browser sees Auth
      SUPABASE_AUTH_INTERNAL_URL: http://gateway:8000 # where this container can actually reach Auth
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres
    ports: ["127.0.0.1:3000:3000"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 2s
      timeout: 3s
      retries: 30
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

// `pnpm stack:check` sets E2E_BASE_URL to the built app in Docker (:3000); otherwise the test runs against Vite.
const external = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: external ?? 'http://localhost:5173', ...devices['Pixel 7'], channel: 'chrome', trace: 'retain-on-failure' },
  webServer: external
    ? undefined
    : { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
})
```

- [ ] **Step 3: Run the integration check**

Run: `pnpm stack:check 2>&1 | tee .superpowers/stack-check.log | tail -25`
Expected: image builds; `app` healthy; integration `25 passed`; Playwright `1 passed` against `http://localhost:3000`. Exit code 0.

- [ ] **Step 4: Confirm the app on :3000 is the production build**

Run: `curl -sI http://localhost:3000/settings | grep -i '^content-security-policy'; curl -s http://localhost:3000/api/me -o /dev/null -w '%{http_code}\n'`
Expected: CSP containing `connect-src 'self' http://127.0.0.1:54321`; then `401`.

- [ ] **Step 5: Dev-mode e2e still works**

Run: `pnpm test:e2e`
Expected: `1 passed` (Vite on :5173).

- [ ] **Step 6: Commit**

```bash
git add .dockerignore docker/app.Dockerfile docker-compose.yml playwright.config.ts
git commit -m "feat(stack): stack:check runs integration and e2e against the built app in Docker"
```

---

### Task 7: e2e cleans up its user; unit test for the 401 redirect

**Files:**
- Create: `e2e/global-teardown.ts`, `apps/web/src/lib/unauthorized.ts`, `apps/web/test/unauthorized.test.ts`
- Modify: `playwright.config.ts` (globalTeardown), `packages/test-utils/src/index.ts` (`deleteTestUser` reports failure), `apps/web/src/main.ts`

**Interfaces:**
- Produces: `redirectToLogin(router: Router): Promise<unknown> | undefined` — on 401, pushes `/login?next=<current fullPath>` unless already on `/login`.

- [ ] **Step 1: Show the leak (RED for the teardown)**

Run: `Q="select count(*) from auth.users where email like 'e2e-%'"; docker compose --env-file docker/.env.stack.local exec -T db psql -U postgres -tAc "$Q"; pnpm test:e2e >/dev/null; docker compose --env-file docker/.env.stack.local exec -T db psql -U postgres -tAc "$Q"`
Expected: the second count is one higher than the first (each run leaves a user behind).

- [ ] **Step 2: Write the failing web unit test**

`apps/web/test/unauthorized.test.ts`:

```ts
import { expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { redirectToLogin } from '../src/lib/unauthorized'

const Blank = { template: '<div />' }
async function routerAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/settings', '/login'].map((p) => ({ path: p, component: Blank })),
  })
  await router.push(path)
  return router
}

it('sends me to sign-in and remembers the page I was on, query included (AUTH-2)', async () => {
  const router = await routerAt('/settings?tab=import')
  await redirectToLogin(router)
  expect(router.currentRoute.value.path).toBe('/login')
  expect(router.currentRoute.value.query.next).toBe('/settings?tab=import')
})

it('does nothing when I am already on the sign-in page', async () => {
  const router = await routerAt('/login?next=/settings')
  expect(redirectToLogin(router)).toBeUndefined()
  expect(router.currentRoute.value.fullPath).toBe('/login?next=/settings')
})
```

Run: `pnpm --filter @nri/web test`
Expected: FAIL — `Failed to resolve import "../src/lib/unauthorized"`.

- [ ] **Step 3: Implement both**

`apps/web/src/lib/unauthorized.ts`:

```ts
import type { Router } from 'vue-router'

/** On a 401 from the API: go to sign-in, remembering the page to come back to (AUTH-2). */
export function redirectToLogin(router: Router) {
  const current = router.currentRoute.value
  if (current.path === '/login') return undefined
  return router.push({ path: '/login', query: { next: current.fullPath } })
}
```

`apps/web/src/main.ts` — replace the `setOnUnauthorized(() => { … })` block and add the import:

```ts
import { redirectToLogin } from './lib/unauthorized'

setOnUnauthorized(() => void redirectToLogin(router))
```

`packages/test-utils/src/index.ts` — `deleteTestUser` reports failures (a silent failure is how users leaked):

```ts
export async function deleteTestUser(id: string): Promise<void> {
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
  })
  if (!res.ok && res.status !== 404) throw new Error(`delete user failed: ${res.status} ${await res.text()}`)
}
```

`e2e/global-teardown.ts`:

```ts
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { deleteTestUser } from '@nri/test-utils'

export default async function globalTeardown() {
  if (!existsSync('.e2e-user.json')) return
  process.loadEnvFile('.env.local')
  const { id } = JSON.parse(readFileSync('.e2e-user.json', 'utf8')) as { id: string }
  await deleteTestUser(id)
  rmSync('.e2e-user.json')
}
```

`playwright.config.ts`: add `globalTeardown: './e2e/global-teardown.ts',` after `globalSetup`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @nri/web test && pnpm --filter @nri/web typecheck`
Expected: web tests 8 passed (6 + 2); typecheck clean.

Run the Step 1 command again.
Expected: the two counts are equal, and `.e2e-user.json` no longer exists afterwards.

- [ ] **Step 5: Commit**

```bash
git add e2e/global-teardown.ts apps/web/src/lib/unauthorized.ts apps/web/test/unauthorized.test.ts apps/web/src/main.ts packages/test-utils/src/index.ts playwright.config.ts
git commit -m "test: e2e deletes its user; unit-test the 401 redirect to sign-in"
```

---

### Task 8: CI on the compose stack

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm stack:keys`, `pnpm stack:check` (Tasks 1, 3, 6).

- [ ] **Step 1: Replace the workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:unit
      - run: pnpm test:scripts
      # Local-only keys for this runner; also writes the .env.local the build and tests read.
      - run: pnpm stack:keys
      # Production build (web + bundled API + CSP from the embedded Supabase URL) must succeed on its own too.
      - run: pnpm build:vercel
      - run: pnpm exec playwright install --with-deps chrome
      # Same command as on the Mac: compose stack, built app on :3000, integration + e2e tests.
      - run: pnpm stack:check
      - name: Collect logs on failure
        if: failure()
        run: docker compose --env-file docker/.env.stack.local --profile app logs > compose.log 2>&1 || true
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: stack-check-diagnostics
          path: |
            compose.log
            playwright-report/
            test-results/
          retention-days: 7
```

- [ ] **Step 2: Rehearse the CI sequence locally from a clean state**

Run: `pnpm stack:reset && rm -f docker/.env.stack.local .env.local && pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:scripts && pnpm stack:keys && pnpm build:vercel && pnpm stack:check`
Expected: every step passes; final lines show integration `25 passed` and e2e `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the integration check on the docker compose stack, adding e2e"
```

- [ ] **Step 4: Ask before pushing**

Ask the user whether to push `local-stack` and open a pull request against `main` (CI runs on pull requests). Do not push without a yes. When approved: `git push -u origin local-stack && gh pr create --fill --base main`, then `gh pr checks --watch`. Expected: the `test` job passes.

---

### Task 9: Documentation, checklist and plan page

**Files:**
- Modify: `docs/trd.md`, `docs/checklist.md`, `docs/diagrams/nri-plan-overview.html`

- [ ] **Step 1: TRD**

In `docs/trd.md`:
- §2 repo layout: replace the line `├── supabase/             Supabase CLI config for local Postgres + Auth` with `├── docker/               Local stack support: db init SQL, nginx gateway, app image` and add `├── docker-compose.yml    Local stack: Supabase Postgres + Auth, gateway, app (profile)` beside it.
- §9.1: replace the Local row with

```
| Local (dev) | `pnpm stack:up`, then `pnpm dev` (Vite + Hono on the Mac, hot reload) | docker compose: Supabase Postgres 17 + Auth, nginx gateway on 127.0.0.1:54321 |
| Local (check) | `pnpm stack:check`: the Vercel build output in a container on :3000 | Same compose stack |
```

- §10: API integration tool `Vitest + docker compose stack`; End-to-end row adds "against Vite in dev and the built app in `stack:check`". Replace the CI sentence with: "CI runs typecheck, lint, unit and script tests, the production build, then `pnpm stack:check` (integration and e2e against the built app). E2E also runs against the Vercel preview URL once deploys exist."
- §12 item 2: "Local development uses a project-owned docker compose stack (needs Docker Desktop on the Mac); see `docs/superpowers/specs/2026-10-05-local-stack-design.md`."

Run: `grep -n "Supabase CLI\|supabase start" docs/trd.md`
Expected: no output.

- [ ] **Step 2: Checklist**

In `docs/checklist.md`: set every "Local stack" row to ✅ with the commit range in Notes; "Spec written and approved" ✅; set the M0 milestone status to "🟡 code + local stack done; cloud deploy ⬜"; mark the fix-queue row "e2e deletes its test user; unit test for the 401 → ?next= redirect" done; update "Last updated"; add `pnpm stack:check` to the CI row note ("adds e2e").

- [ ] **Step 3: Plan page**

In `docs/diagrams/nri-plan-overview.html`:
- `WBS` data: set `s:'done'` on 1.4.1–1.4.11 (1.4.2 and 1.4.3 included); 1.1.4 note → `'CI runs stack:check (integration + e2e)'`.
- Local stack diagram (migrations now run from the Mac, spec §13.2):
  - delete the `migrate (one-shot)` `<rect>` and its two `<text>` lines, and the `<path … d="M610 305 H770" …/>` with its `migrations, after auth` label;
  - change the label of `<path … d="M290 200 H320 V262 H770" …/>` from `SQL :54322` to `SQL + migrations :54322`;
  - change `class="box wip"` to `class="box done"` on the gateway, auth, app and db rects;
  - figcaption: replace "Daily coding: `pnpm stack:up` then `pnpm dev`." with "Daily coding: `pnpm stack:up` (starts the stack, then runs migrations from the Mac) then `pnpm dev`."
- Roadmap M0 card: `Local stack ✅`; M0 path chip "Local Docker stack" → `s-done`; move the "you are here" step to "Cloud deploy" (`s-wip`).
- Status line in the header: "Status as of <date>".

Run the screenshot check used before (desktop + phone): no console errors, no horizontal scroll, labels not overlapping.

- [ ] **Step 4: Commit**

```bash
git add docs/trd.md docs/checklist.md docs/diagrams/nri-plan-overview.html
git commit -m "docs: TRD, checklist and plan page describe the compose stack"
```
