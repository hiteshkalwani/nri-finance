import { expect, it } from 'vitest'
import { loadConfig } from '../src/config'

it('ignores SUPABASE_JWT_SECRET from the environment, so production always verifies against JWKS', () => {
  const c = loadConfig({ SUPABASE_URL: 'https://x.supabase.co/', DATABASE_URL: 'postgres://x', SUPABASE_JWT_SECRET: 'leaked' })
  expect(c.jwtSecret).toBeUndefined()
  expect(c.supabaseUrl).toBe('https://x.supabase.co')
})

it('reads SUPABASE_AUTH_INTERNAL_URL, used only inside Docker to reach Auth', () => {
  const c = loadConfig({ SUPABASE_URL: 'http://127.0.0.1:54321', DATABASE_URL: 'postgres://x', SUPABASE_AUTH_INTERNAL_URL: 'http://gateway:8000/' })
  expect(c.authInternalUrl).toBe('http://gateway:8000')
  expect(c.supabaseUrl).toBe('http://127.0.0.1:54321')
})

it('leaves the internal URL unset in production', () => {
  expect(loadConfig({ SUPABASE_URL: 'https://x.supabase.co', DATABASE_URL: 'postgres://x' }).authInternalUrl).toBeUndefined()
})
