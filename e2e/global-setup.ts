import { writeFileSync } from 'node:fs'
import { createTestUser } from '@nri/test-utils'

export default async function globalSetup() {
  process.loadEnvFile('.env.local')
  const user = await createTestUser('e2e')
  writeFileSync('.e2e-user.json', JSON.stringify(user))
}
