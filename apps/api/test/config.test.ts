import { expect, it } from 'vitest'
import { loadConfig } from '../src/config'

it('ignores SUPABASE_JWT_SECRET from the environment, so production always verifies against JWKS', () => {
  const c = loadConfig({ SUPABASE_URL: 'https://x.supabase.co/', DATABASE_URL: 'postgres://x', SUPABASE_JWT_SECRET: 'leaked' })
  expect(c.jwtSecret).toBeUndefined()
  expect(c.supabaseUrl).toBe('https://x.supabase.co')
})
