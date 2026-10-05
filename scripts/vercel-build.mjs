import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import { outputConfig, securityHeaders } from './vercel-headers.mjs'

const out = '.vercel/output'
rmSync(out, { recursive: true, force: true })

execSync('pnpm --filter @nri/web build', { stdio: 'inherit' })
// The Supabase URL the bundle actually embedded (written by the web build), so CSP and bundle can't disagree.
const { VITE_SUPABASE_URL } = JSON.parse(readFileSync('apps/web/dist/.public-env.json', 'utf8'))
const headers = securityHeaders(VITE_SUPABASE_URL)
cpSync('apps/web/dist', `${out}/static`, { recursive: true, filter: (src) => !src.endsWith('.public-env.json') })

const fn = `${out}/functions/api.func`
mkdirSync(fn, { recursive: true })
await build({
  entryPoints: ['apps/api/src/vercel.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: `${fn}/index.mjs`,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }))
// hnd1 = Tokyo, next to the Supabase project (ap-northeast-1); each request makes several DB round trips.
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', regions: ['hnd1'] }))

writeFileSync(`${out}/config.json`, JSON.stringify(outputConfig(headers), null, 2))
console.log('Vercel build output written to', out)
