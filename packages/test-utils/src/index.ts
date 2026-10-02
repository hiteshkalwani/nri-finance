import { randomUUID } from 'node:crypto'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} missing — run "pnpm test:env" with Supabase running`)
  return v
}

export type TestUser = { id: string; email: string; password: string; accessToken: string }

export async function createTestUser(prefix = 'test'): Promise<TestUser> {
  const email = `${prefix}-${randomUUID()}@example.test`
  const password = `pw-${randomUUID()}`
  const admin = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!admin.ok) throw new Error(`create user failed: ${admin.status} ${await admin.text()}`)
  const { id } = (await admin.json()) as { id: string }
  const token = await fetch(`${env('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_ANON_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!token.ok) throw new Error(`sign in failed: ${token.status} ${await token.text()}`)
  const { access_token } = (await token.json()) as { access_token: string }
  return { id, email, password, accessToken: access_token }
}

export async function deleteTestUser(id: string): Promise<void> {
  await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
  })
}
