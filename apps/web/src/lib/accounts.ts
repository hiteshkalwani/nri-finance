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

/**
 * A net-worth change's "↑/↓ <amount> (<pct>%)" display text and up/down flag — shared by the
 * Accounts and Dashboard net-worth cards (spec §4.1, §4.4). `null` only when `changeJpy` itself
 * is null (first cycle — no prior total to compare against at all). `changePct` is null on its
 * own whenever the previous total was 0 (a percent change from zero is undefined) — that's still
 * a real ¥ change, so it's shown with its ↑/↓ arrow and amount, just without a "(…%)" suffix
 * (final review finding 5 — this used to read as "first cycle" too, hiding a real change).
 * `amountLabel` formats the absolute ¥ amount in whichever currency/representation the caller
 * wants shown (Accounts re-expresses it via `showIn`; the Dashboard always shows ¥). Colour is
 * never the only signal (spec §5): the caller still applies the up/down colour class itself,
 * alongside this text's own ↑/↓ glyph.
 */
export function netWorthChangeDisplay(
  changeJpy: number | null,
  changePct: number | null,
  amountLabel: (absJpy: number) => string,
): { up: boolean; text: string } | null {
  if (changeJpy === null) return null
  const up = changeJpy >= 0
  const pct = changePct === null ? '' : ` (${Math.abs(changePct).toFixed(1)}%)`
  return { up, text: `${up ? '↑' : '↓'} ${amountLabel(Math.abs(changeJpy))}${pct}` }
}

/** Emergency-fund progress toward its ¥ goal, 0–100 (clamped); `null` when there's no goal (or it's 0). */
export function emergencyFundPct(balanceJpy: number, goalJpy: number | null): number | null {
  if (goalJpy === null || goalJpy <= 0) return null
  return Math.min(100, Math.round((balanceJpy / goalJpy) * 100))
}
