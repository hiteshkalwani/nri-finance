// Generates the local-only keys for the docker compose stack, and the .env.local the app and tests read.
// None of these values are used anywhere but this machine (or a CI runner).
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  writeAppEnv({ root, keys })
  return keys
}

export function readStackEnv({ root = process.cwd() } = {}) {
  return Object.fromEntries(
    readFileSync(join(root, STACK_ENV), 'utf8').trim().split('\n').map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1).replace(/^'(.*)'$/, '$1')]
    }),
  )
}

// .env.local is fully derived from the stack keys, so it can always be rebuilt (e.g. after `vercel env pull`).
export function writeAppEnv({ root = process.cwd(), keys = readStackEnv({ root }) } = {}) {
  writeFileSync(join(root, APP_ENV), dotenv(appEnv(keys)), { mode: 0o600 })
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
