import { sql } from 'drizzle-orm'
import type { Account } from '@nri/contracts'
import type { Tx } from '@nri/db'
import { ApiError } from '../errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function assertId(id: string, what = 'account'): string {
  if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', `That ${what} no longer exists`)
  return id
}

/** My accounts, with `hasBalances` (any snapshot ever recorded). Active only unless `includeArchived`. */
export async function listAccounts(
  tx: Tx,
  userId: string,
  opts: { includeArchived?: boolean; id?: string } = {},
): Promise<Account[]> {
  const { includeArchived, id } = opts
  const rows = await tx.execute<Account>(sql`
    select a.id, a.name, a.country, a.currency, a.type, a.is_emergency_fund as "isEmergencyFund",
      a.archived_at is not null as archived,
      exists (select 1 from balance_snapshots s where s.account_id = a.id) as "hasBalances"
    from accounts a
    where a.user_id = ${userId}
      ${includeArchived ? sql`` : sql`and a.archived_at is null`}
      ${id ? sql`and a.id = ${id}` : sql``}
    order by a.country, a.type, lower(a.name)`)
  return [...rows]
}

export async function getAccount(tx: Tx, userId: string, id: string): Promise<Account> {
  const [acc] = await listAccounts(tx, userId, { includeArchived: true, id })
  if (!acc) throw new ApiError(404, 'NOT_FOUND', 'That account no longer exists')
  return acc
}

/** 409 when an active account of mine already matches `name` case-insensitively (excluding `exceptId`). */
export async function assertUniqueName(tx: Tx, userId: string, name: string, exceptId?: string): Promise<void> {
  const rows = await tx.execute(sql`
    select 1 from accounts
    where user_id = ${userId} and archived_at is null and lower(name) = lower(${name})
      ${exceptId ? sql`and id <> ${exceptId}` : sql``}
    limit 1`)
  if (rows.length) throw new ApiError(409, 'CONFLICT', `You already have an account called "${name}"`)
}
