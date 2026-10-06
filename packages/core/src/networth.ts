import type { Cycle } from './cycles'
import { jpyFromInrPaise } from './money'

export type AccountType = 'bank' | 'cash' | 'card' | 'fd' | 'investment'
export type NwAccount = {
  id: string
  country: 'JP' | 'IN'           // JP ⇔ JPY, IN ⇔ INR
  type: AccountType
  isEmergencyFund: boolean
  archivedCycle: Cycle | null    // cycle in which it was archived (inclusive end of carry-forward)
}
export type Snapshot = { accountId: string; cycle: Cycle; amount: number } // yen for JP, paise for IN; ≥ 0
export type BalanceAt = { amount: number; fromCycle: Cycle; carried: boolean }
export type Side = { japanJpy: number; indiaPaise: number }
export type NetWorth = {
  japanJpy: number; indiaPaise: number; combinedJpy: number   // signed: assets − liabilities
  assets: Side; liabilities: Side                              // both ≥ 0
}

export function balanceAt(snaps: Snapshot[], account: NwAccount, cycle: Cycle): BalanceAt | null {
  if (account.archivedCycle !== null && cycle > account.archivedCycle) return null
  let best: Snapshot | null = null
  for (const sn of snaps) {
    if (sn.accountId !== account.id || sn.cycle > cycle) continue
    if (!best || sn.cycle > best.cycle) best = sn
  }
  return best ? { amount: best.amount, fromCycle: best.cycle, carried: best.cycle !== cycle } : null
}

export function netWorthAt(accounts: NwAccount[], snaps: Snapshot[], cycle: Cycle, rate: string): NetWorth {
  const assets = { japanJpy: 0, indiaPaise: 0 }
  const liabilities = { japanJpy: 0, indiaPaise: 0 }
  for (const a of accounts) {
    const b = balanceAt(snaps, a, cycle)
    if (!b) continue
    const side = a.type === 'card' ? liabilities : assets
    if (a.country === 'JP') side.japanJpy += b.amount
    else side.indiaPaise += b.amount
  }
  const japanJpy = assets.japanJpy - liabilities.japanJpy
  const indiaPaise = assets.indiaPaise - liabilities.indiaPaise
  const combinedJpy = japanJpy + jpyFromInrPaise(assets.indiaPaise, rate) - jpyFromInrPaise(liabilities.indiaPaise, rate)
  return { japanJpy, indiaPaise, combinedJpy, assets, liabilities }
}

export function changeSince(current: number, previous: number | null) {
  if (previous === null) return { changeJpy: null, changePct: null }
  const changeJpy = current - previous
  const base = Math.abs(previous)
  return { changeJpy, changePct: base > 0 ? Math.round((changeJpy * 1000) / base) / 10 : null }
}

export function emergencyFundAt(accounts: NwAccount[], snaps: Snapshot[], cycle: Cycle, rate: string): number {
  let jpy = 0
  let paise = 0
  for (const a of accounts) {
    if (!a.isEmergencyFund || a.type === 'card') continue
    const b = balanceAt(snaps, a, cycle)
    if (!b) continue
    if (a.country === 'JP') jpy += b.amount
    else paise += b.amount
  }
  return jpy + jpyFromInrPaise(paise, rate)
}

export function monthsCovered(efJpy: number, priorSpendJpy: number[]) {
  if (priorSpendJpy.length === 0) return { monthsCovered: null, avgSpendJpy: null }
  const avgSpendJpy = Math.round(priorSpendJpy.reduce((a, b) => a + b, 0) / priorSpendJpy.length)
  return { monthsCovered: avgSpendJpy > 0 ? Math.round((efJpy * 10) / avgSpendJpy) / 10 : null, avgSpendJpy }
}
