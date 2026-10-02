import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Claims = { sub: string; [k: string]: unknown }

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  // prepare:false is required by Supabase's transaction-mode pooler.
  const client = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 5 }) // well inside the 10 s function limit, so our 503 wins over Vercel's 504
  return { db: drizzle(client, { schema }), close: () => client.end() }
}

export function withUser<T>(db: Db, claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // One round trip: transaction-local claims for auth.uid(), and the same effect as SET LOCAL ROLE.
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', 'authenticated', true)`,
    )
    return fn(tx)
  })
}
