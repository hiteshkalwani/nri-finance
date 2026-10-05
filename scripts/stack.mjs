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
