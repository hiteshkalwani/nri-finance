import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const out = '.vercel/output'
rmSync(out, { recursive: true, force: true })

execSync('pnpm --filter @nri/web build', { stdio: 'inherit' })
cpSync('apps/web/dist', `${out}/static`, { recursive: true })

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
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs' }))

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? ''
const headers = {
  'Content-Security-Policy': `default-src 'self'; connect-src 'self' ${supabaseUrl}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
}
writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', headers, continue: true },
    { src: '/api/(.*)', dest: '/api' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2))
console.log('Vercel build output written to', out)
