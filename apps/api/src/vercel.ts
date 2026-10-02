import { getRequestListener } from '@hono/node-server'
import { createDb, type Db } from '@nri/db'
import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig(process.env)
let db: Db | undefined // created on first request, reused while the function instance stays warm
const getDb = () => (db ??= createDb(config.databaseUrl).db)

// Vercel's Node.js runtime calls the default export as (req, res).
export default getRequestListener(createApp({ config, getDb }).fetch)
