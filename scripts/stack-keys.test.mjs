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
