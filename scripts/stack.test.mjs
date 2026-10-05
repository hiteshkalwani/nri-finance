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
