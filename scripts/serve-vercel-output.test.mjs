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
