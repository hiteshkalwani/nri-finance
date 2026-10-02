import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestUser, deleteTestUser, type TestUser } from '@nri/test-utils'
import { categories, createDb, withUser } from '../src/index'

const { db, close } = createDb(process.env.DATABASE_URL!)

/** Drizzle wraps Postgres errors ("Failed query: …"); the database's own message is on `.cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const err = e as Error & { cause?: Error }
    return err.cause?.message ?? err.message
  }
  throw new Error('expected the query to fail')
}
let a: TestUser
let b: TestUser

beforeAll(async () => {
  a = await createTestUser('rls-a')
  b = await createTestUser('rls-b')
})
afterAll(async () => {
  await deleteTestUser(a.id)
  await deleteTestUser(b.id)
  await close()
})

describe('withUser + RLS', () => {
  it('runs as role authenticated with the caller as auth.uid()', async () => {
    const row = await withUser(db, { sub: a.id, role: 'authenticated' }, (tx) =>
      tx.execute(sql`select current_user as role, auth.uid() as uid`),
    )
    expect(row[0]).toMatchObject({ role: 'authenticated', uid: a.id })
  })

  it('lets a user read their own rows but never another user’s', async () => {
    await withUser(db, { sub: a.id }, (tx) =>
      tx.insert(categories).values({ userId: a.id, name: 'Groceries', color: '#4caf50' }),
    )
    const seenByA = await withUser(db, { sub: a.id }, (tx) => tx.select().from(categories))
    const seenByB = await withUser(db, { sub: b.id }, (tx) => tx.select().from(categories))
    expect(seenByA.map((c) => c.name)).toContain('Groceries')
    expect(seenByB).toHaveLength(0)
  })

  it('blocks writing a row owned by someone else', async () => {
    expect(
      await pgError(
        withUser(db, { sub: b.id }, (tx) => tx.insert(categories).values({ userId: a.id, name: 'Sneaky', color: '#000' })),
      ),
    ).toMatch(/row-level security/)
  })

  it('blocks updating another user’s row (zero rows affected)', async () => {
    const updated = await withUser(db, { sub: b.id }, (tx) =>
      tx.update(categories).set({ name: 'Hijacked' }).where(eq(categories.userId, a.id)).returning(),
    )
    expect(updated).toHaveLength(0)
  })

  it('rejects a duplicate category name ignoring case', async () => {
    expect(
      await pgError(
        withUser(db, { sub: a.id }, (tx) => tx.insert(categories).values({ userId: a.id, name: 'groceries', color: '#111' })),
      ),
    ).toMatch(/categories_user_name/)
  })
})
