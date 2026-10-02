import { test } from 'node:test'
import assert from 'node:assert/strict'
import { securityHeaders } from './vercel-headers.mjs'

test('connect-src allows exactly the Supabase origin the bundle uses', () => {
  const h = securityHeaders('https://abcd.supabase.co')
  assert.match(h['Content-Security-Policy'], /connect-src 'self' https:\/\/abcd\.supabase\.co;/)
})

test('refuses to build without a Supabase URL (sign-in would be blocked by CSP)', () => {
  assert.throws(() => securityHeaders(''), /VITE_SUPABASE_URL/)
  assert.throws(() => securityHeaders(undefined), /VITE_SUPABASE_URL/)
})

test('refuses plain http except for a local Supabase', () => {
  assert.throws(() => securityHeaders('http://abcd.supabase.co'), /https/)
  assert.doesNotThrow(() => securityHeaders('http://127.0.0.1:54321'))
  assert.doesNotThrow(() => securityHeaders('http://localhost:54321'))
})

test('locks down framing, base URI and plugins', () => {
  const csp = securityHeaders('https://abcd.supabase.co')['Content-Security-Policy']
  for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'"]) assert.ok(csp.includes(d), d)
})
