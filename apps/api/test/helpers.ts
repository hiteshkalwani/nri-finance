import { createDb } from '@nri/db'
import { createApp } from '../src/app'
import { loadConfig } from '../src/config'

export function testApp() {
  const config = loadConfig(process.env)
  const { db, close } = createDb(config.databaseUrl)
  return { app: createApp({ config, getDb: () => db }), close }
}

export const json = (token: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})
