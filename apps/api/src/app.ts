import { Hono } from 'hono'
import type { Db } from '@nri/db'
import type { Config } from './config'
import { toErrorResponse } from './errors'
import { authMiddleware, type AuthVars } from './middleware/auth'

export type AppDeps = { config: Config; getDb: () => Db }

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AuthVars }>()

  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err)
    return c.json(body, status)
  })
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  )

  app.get('/api/health', (c) => c.json({ ok: true }))

  const auth = authMiddleware(deps.config)
  app.use('/api/*', async (c, next) => (c.req.path === '/api/health' ? next() : auth(c, next)))

  return app
}
