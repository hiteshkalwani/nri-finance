// One entry point for the local docker compose stack:
//   pnpm stack:up | stack:check | stack:down | stack:reset
// Stops at the first failing step; on a failure it prints `docker compose ps` and recent logs.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STACK_ENV, appEnv, readStackEnv, writeAppEnv, writeStackEnv } from './stack-keys.mjs'

export const E2E_BASE_URL = 'http://localhost:3000'
const INFRA = ['db', 'auth', 'gateway']
// docker-compose.yml fixes the project name, so every checkout of this repo shares this volume.
const VOLUME = 'nri-finance_db-data'
const RESET_HINT =
  'The database was created with different keys. To keep its data, copy docker/.env.stack.local from the checkout\n' +
  'that created it,\n' +
  'or start fresh (deletes local data): pnpm stack:reset && pnpm stack:keys --force && pnpm stack:up'
// Without the env file (fresh clone, before `up`), `down` / `reset` must still work.
const compose = () => ['docker', 'compose', ...(existsSync(STACK_ENV) ? ['--env-file', STACK_ENV] : [])]

/**
 * `env` is the stack's own .env.local values. Steps that touch the database get them explicitly, so a DATABASE_URL
 * (or SUPABASE_URL) exported in the shell, e.g. for the cloud project, can never redirect migrations or tests.
 */
export function steps(cmd, env = {}) {
  switch (cmd) {
    case 'up':
      return [
        { cmd: [...compose(), 'up', '-d', '--wait', '--wait-timeout', '180', ...INFRA] },
        // Our RLS migration references auth.users, which Auth creates on start, so this runs after `--wait`.
        { cmd: ['pnpm', 'db:migrate'], env },
      ]
    case 'check':
      return [
        ...steps('up', env),
        { cmd: [...compose(), '--profile', 'app', 'up', '-d', '--build', '--wait', '--wait-timeout', '300', 'app'] },
        { cmd: ['pnpm', 'test:integration'], env },
        { cmd: ['pnpm', 'test:e2e'], env: { ...env, E2E_BASE_URL } },
      ]
    case 'down':
      return [{ cmd: [...compose(), '--profile', 'app', 'down'] }]
    case 'reset':
      return [{ cmd: [...compose(), '--profile', 'app', 'down', '-v'] }]
    default:
      throw new Error(`unknown command "${cmd}" (use up, check, down, reset)`)
  }
}

/** What to do about keys before `up`: reuse them, generate them, or refuse (a database exists that needs the old ones). */
export function prepare({ hasKeys, volumeExists }) {
  if (hasKeys) return 'sync'
  if (!volumeExists) return 'generate'
  throw new Error(`A local database already exists, but this checkout has no ${STACK_ENV}.\n${RESET_HINT}`)
}

/** A recovery hint for what Auth logged, or null. */
export function hintFor(authLogs) {
  return /password authentication failed/.test(authLogs) ? RESET_HINT : null
}

function run({ cmd, env }) {
  console.log(`\n$ ${cmd.join(' ')}`)
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.error) console.error(r.error.message)
  return r.status === 0
}

function diagnose() {
  const c = compose()
  spawnSync(c[0], [...c.slice(1), '--profile', 'app', 'ps', '-a'], { stdio: 'inherit' })
  spawnSync(c[0], [...c.slice(1), '--profile', 'app', 'logs', '--tail', '50'], { stdio: 'inherit' })
  const auth = spawnSync(c[0], [...c.slice(1), 'logs', '--tail', '100', 'auth'], { encoding: 'utf8' })
  const hint = hintFor(`${auth.stdout ?? ''}${auth.stderr ?? ''}`)
  if (hint) console.error(`\n${hint}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2]
  try {
    let env = {}
    if (cmd === 'up' || cmd === 'check') {
      const volumeExists = spawnSync('docker', ['volume', 'inspect', VOLUME], { stdio: 'ignore' }).status === 0
      if (prepare({ hasKeys: existsSync(STACK_ENV), volumeExists }) === 'generate') {
        writeStackEnv()
        console.log(`generated ${STACK_ENV} and .env.local`)
      } else {
        writeAppEnv() // rebuilds .env.local if it was lost or overwritten
      }
      env = appEnv(readStackEnv())
    }
    for (const step of steps(cmd, env)) {
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
