import { Hono, type MiddlewareHandler } from 'hono'
import type { Db } from '@nri/db'
import type { Config } from './config'
import { toErrorResponse } from './errors'
import { authMiddleware } from './middleware/auth'
import { dbMiddleware, type AppVars } from './middleware/db'
import { accountRoutes } from './routes/accounts'
import { balanceRoutes } from './routes/balances'
import { categoryRoutes } from './routes/categories'
import { dashboardRoutes } from './routes/dashboard'
import { importRoutes } from './routes/import'
import { meRoutes } from './routes/me'
import { transactionRoutes } from './routes/transactions'

export type AppDeps = { config: Config; getDb: () => Db }

// Each middleware declares only the variables it sets; this wrapper accepts any of them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exceptHealth = (mw: MiddlewareHandler<any>): MiddlewareHandler<any> => (c, next) =>
  c.req.path === '/api/health' ? next() : mw(c, next)

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AppVars }>()

  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err)
    return c.json(body, status)
  })
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  )

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.use('/api/*', exceptHealth(authMiddleware(deps.config)))
  app.use('/api/*', exceptHealth(dbMiddleware(deps.getDb)))

  app.route('/api/me', meRoutes)
  app.route('/api/import', importRoutes)
  app.route('/api/categories', categoryRoutes)
  app.route('/api/transactions', transactionRoutes)
  app.route('/api/accounts', accountRoutes)
  app.route('/api/balances', balanceRoutes)
  app.route('/api/dashboard', dashboardRoutes)

  return app
}
