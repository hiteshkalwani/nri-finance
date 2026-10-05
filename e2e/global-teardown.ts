import { existsSync, readFileSync, rmSync } from 'node:fs'
import { deleteTestUser } from '@nri/test-utils'

export default async function globalTeardown() {
  if (!existsSync('.e2e-user.json')) return
  process.loadEnvFile('.env.local')
  const { id } = JSON.parse(readFileSync('.e2e-user.json', 'utf8')) as { id: string }
  await deleteTestUser(id)
  rmSync('.e2e-user.json')
}
