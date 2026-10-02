import { serve } from '@hono/node-server'
import { createDb } from '@nri/db'
import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig(process.env)
const { db } = createDb(config.databaseUrl)
serve({ fetch: createApp({ config, getDb: () => db }).fetch, port: 8787 }, (info) =>
  console.log(`api on http://localhost:${info.port}`),
)
