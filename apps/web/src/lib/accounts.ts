import { inrPaiseFromJpy, jpyFromInrPaise } from '@nri/core'
import type { AccountType } from '@nri/contracts'

/** Account-group display order (spec §4.1): Bank, Cash, FD, Investment, Cards. */
export const TYPE_ORDER: readonly AccountType[] = ['bank', 'cash', 'fd', 'investment', 'card']
export const TYPE_LABEL: Record<AccountType, string> = {
  bank: 'Bank', cash: 'Cash', fd: 'Fixed deposits', investment: 'Investments', card: 'Cards',
}

/** Groups rows by `TYPE_ORDER`, each group's rows sorted by name; a type with no rows is dropped entirely. */
export function groupByType<T extends { type: AccountType; name: string }>(
  rows: T[],
): { type: AccountType; label: string; rows: T[] }[] {
  return TYPE_ORDER.map((type) => ({
    type,
    label: TYPE_LABEL[type],
    rows: rows.filter((r) => r.type === type).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.rows.length > 0)
}

export type ShowIn = 'JPY' | 'INR'
const SHOW_IN_KEY = 'nri.accounts.showIn'

/** The Accounts page's remembered "In ¥ / In ₹" choice (per device); falls back to 'JPY' if storage throws or holds junk. */
export function loadShowIn(): ShowIn {
  try {
    return localStorage.getItem(SHOW_IN_KEY) === 'INR' ? 'INR' : 'JPY'
  } catch {
    return 'JPY'
  }
}

export function saveShowIn(v: ShowIn): void {
  try {
    localStorage.setItem(SHOW_IN_KEY, v)
  } catch {
    // Storage may be unavailable (private browsing, quota) — the choice just isn't remembered.
  }
}

/** `amount` (yen if `currency` is 'JPY', paise if 'INR') converted to the other currency at the planning `rate`. */
export function inOtherCurrency(amount: number, currency: 'JPY' | 'INR', rate: string): number {
  return currency === 'JPY' ? inrPaiseFromJpy(amount, rate) : jpyFromInrPaise(amount, rate)
}
