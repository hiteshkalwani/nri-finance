import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// Local runs read the generated .env.local; CI and production pass DATABASE_URL explicitly.
if (!process.env.DATABASE_URL && existsSync('../../.env.local')) process.loadEnvFile('../../.env.local')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
