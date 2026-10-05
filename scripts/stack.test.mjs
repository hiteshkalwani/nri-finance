import assert from 'node:assert/strict'
import { test } from 'node:test'
import { E2E_BASE_URL, hintFor, prepare, steps } from './stack.mjs'

const lines = (cmd) => steps(cmd).map((s) => s.cmd.join(' '))
// What the stack's own .env.local says; must win over anything exported in the shell.
const stackEnv = { DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:54322/postgres', SUPABASE_URL: 'http://127.0.0.1:54321' }

test('up starts the infrastructure, waits for health, then migrates from the Mac', () => {
  const s = lines('up')
  assert.equal(s.length, 2)
  assert.match(s[0], /^docker compose( --env-file \S+)? up -d --wait --wait-timeout \d+ db auth gateway$/)
  assert.equal(s[1], 'pnpm db:migrate')
})

test('check = up, then build and start the app, then integration and e2e against :3000', () => {
  const s = steps('check', stackEnv)
  assert.deepEqual(s.slice(0, 2), steps('up', stackEnv))
  assert.match(s[2].cmd.join(' '), /--profile app up -d --build --wait --wait-timeout \d+ app$/)
  assert.equal(s[3].cmd.join(' '), 'pnpm test:integration')
  assert.equal(s[4].cmd.join(' '), 'pnpm test:e2e')
  assert.deepEqual(s[4].env, { ...stackEnv, E2E_BASE_URL })
  assert.equal(E2E_BASE_URL, 'http://localhost:3000')
  assert.equal(s.length, 5)
})

test('migrations and tests always target the local stack, even with a cloud DATABASE_URL exported', () => {
  assert.deepEqual(steps('up', stackEnv)[1].env, stackEnv)
  assert.deepEqual(steps('check', stackEnv)[3].env, stackEnv)
})

test('down keeps the database volume; reset removes it', () => {
  assert.match(lines('down')[0], /--profile app down$/)
  assert.match(lines('reset')[0], /--profile app down -v$/)
})

test('unknown commands are refused with the valid list', () => {
  assert.throws(() => steps('nope'), /unknown command "nope".*up, check, down, reset/)
})

test('keys: reuse existing ones, generate on a clean machine, refuse when a database already exists without them', () => {
  assert.equal(prepare({ hasKeys: true, volumeExists: true }), 'sync')
  assert.equal(prepare({ hasKeys: true, volumeExists: false }), 'sync')
  assert.equal(prepare({ hasKeys: false, volumeExists: false }), 'generate')
  assert.throws(
    () => prepare({ hasKeys: false, volumeExists: true }),
    /database already exists[\s\S]*copy docker\/\.env\.stack\.local[\s\S]*pnpm stack:reset/,
  )
})

test('explains the key/password mismatch Auth logs when keys and database disagree', () => {
  assert.match(hintFor('FATAL: password authentication failed for user "supabase_auth_admin"'), /pnpm stack:reset/)
  assert.equal(hintFor('auth started on :9999'), null)
})
