import { createMiddleware } from 'hono/factory'
import { withUser, type Db, type Tx } from '@nri/db'
import type { AuthVars } from './auth'

export type AppVars = AuthVars & { db: Tx }
const ROLLBACK = Symbol('rollback')

/** Runs the rest of the request in one transaction as the caller; rolls back if the handler failed. */
export function dbMiddleware(getDb: () => Db) {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    try {
      await withUser(getDb(), c.var.claims, async (tx) => {
        c.set('db', tx)
        await next()
        if (c.error) throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
  })
}
