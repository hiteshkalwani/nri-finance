import { eq } from 'drizzle-orm'
import { cycleOf, paiseFromDecimal, todayIn, type NwAccount, type Snapshot } from '@nri/core'
import { accounts, balanceSnapshots, type Tx } from '@nri/db'

export type NetWorthAccount = NwAccount & { name: string; currency: 'JPY' | 'INR'; archived: boolean }

/**
 * Every account (active and archived) and every snapshot of mine, shaped for `@nri/core`'s net-worth
 * functions. Shared by the balances (review-day) and net-worth APIs.
 */
export async function loadNetWorthInputs(
  tx: Tx,
  userId: string,
  startDay: number,
  timezone: string,
): Promise<{ accounts: NetWorthAccount[]; snaps: Snapshot[] }> {
  const accountRows = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      country: accounts.country,
      currency: accounts.currency,
      type: accounts.type,
      isEmergencyFund: accounts.isEmergencyFund,
      archivedAt: accounts.archivedAt,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))

  const loaded: NetWorthAccount[] = accountRows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    currency: r.currency,
    type: r.type,
    isEmergencyFund: r.isEmergencyFund,
    archived: r.archivedAt !== null,
    archivedCycle: r.archivedAt ? cycleOf(todayIn(timezone, r.archivedAt), startDay) : null,
  }))

  const snapRows = await tx
    .select({
      accountId: balanceSnapshots.accountId,
      cycle: balanceSnapshots.cycle,
      balanceJpy: balanceSnapshots.balanceJpy,
      balanceInr: balanceSnapshots.balanceInr,
    })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.userId, userId))

  const snaps: Snapshot[] = snapRows.map((r) => ({
    accountId: r.accountId,
    cycle: r.cycle,
    amount: r.balanceJpy ?? paiseFromDecimal(r.balanceInr!),
  }))

  return { accounts: loaded, snaps }
}
