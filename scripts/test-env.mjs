import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const raw = execSync('pnpm exec supabase status -o env', { encoding: 'utf8' })
const env = Object.fromEntries(
  raw
    .split('\n')
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
const out = {
  SUPABASE_URL: env.API_URL,
  SUPABASE_ANON_KEY: env.ANON_KEY ?? env.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY ?? env.SECRET_KEY,
  // No SUPABASE_JWT_SECRET: local Auth signs ES256 tokens published at the JWKS URL, same as production,
  // so the API verifies them the same way everywhere. Only unit tests pass a secret explicitly.
  DATABASE_URL: env.DB_URL,
  VITE_SUPABASE_URL: env.API_URL,
  VITE_SUPABASE_ANON_KEY: env.ANON_KEY ?? env.PUBLISHABLE_KEY,
}
for (const [k, v] of Object.entries(out)) if (!v) throw new Error(`supabase status did not report ${k}`)
writeFileSync('.env.local', Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
console.log('wrote .env.local')
