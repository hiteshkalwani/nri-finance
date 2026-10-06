import type { BalanceRow } from '@nri/contracts'
import { decimalFromPaise, jpyFromInrPaise } from '@nri/core'

export type Currency = 'JPY' | 'INR'
export type FieldState = { accountId: string; text: string; initial: string; currency: Currency }

/** `amount` (yen for JPY, paise for INR) as the text a field should be prefilled with; `null` (no balance yet) → ''. */
export function toText(amount: number | null, currency: Currency): string {
  if (amount === null) return ''
  return currency === 'JPY' ? String(amount) : decimalFromPaise(amount)
}

/**
 * Parses what the user typed into an amount in the account's own currency (yen or paise).
 * `''` (blank) → `null` (nothing entered). Commas are stripped before parsing. ¥ accepts whole
 * yen only; ₹ accepts up to 2 decimal places. Anything else — a minus sign, letters, too many
 * decimals, a lone decimal point — is `'invalid'`.
 */
export function parseAmount(text: string, currency: Currency): number | null | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const cleaned = trimmed.replace(/,/g, '')
  if (currency === 'JPY') {
    return /^\d+$/.test(cleaned) ? Number(cleaned) : 'invalid'
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned)
  if (!m) return 'invalid'
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/**
 * The entries to PUT: every field with a non-empty, validly-parsed amount that either differs
 * from its prefilled `initial` text (the user actually typed something new), or whose GET row
 * came from a cycle other than this one ('carried'/'none') — saving confirms that carried (or,
 * once typed, brand new) value as this cycle's own snapshot even when the user left the prefilled
 * text untouched. A blank field, or one `parseAmount` can't parse, is skipped either way.
 */
export function changedEntries(fields: FieldState[], rows: BalanceRow[]): { accountId: string; amount: number }[] {
  const rowById = new Map(rows.map((r) => [r.accountId, r]))
  const out: { accountId: string; amount: number }[] = []
  for (const f of fields) {
    const parsed = parseAmount(f.text, f.currency)
    if (typeof parsed !== 'number') continue
    const row = rowById.get(f.accountId)
    const edited = f.text !== f.initial
    const confirmsCarried = row !== undefined && row.source !== 'this'
    if (edited || confirmsCarried) out.push({ accountId: f.accountId, amount: parsed })
  }
  return out
}

/** True once any field's text no longer matches what it was prefilled with. */
export function isDirty(fields: FieldState[]): boolean {
  return fields.some((f) => f.text !== f.initial)
}

/**
 * Live "net worth after saving" for the sticky footer (controller ruling, Task 8): the cycle's
 * current combined ¥ net worth, adjusted by every *edited* field's own signed ¥ delta — the
 * difference between what the field would save as and the GET row's own `amount` — rather than
 * recomputing net worth from scratch client-side. A card account's delta is subtracted (more owed
 * is worse); a ₹ account's old and new amounts are each converted to ¥ at `rate` separately (both
 * clamped to non-negative, never negated before converting) and only then differenced. A blank or
 * unparsable edited field counts as 0 — "as if saved empty" — which only matters while Save stays
 * disabled for it; an unedited field (including a blank one that was never touched) contributes
 * nothing, since the baseline `combinedJpy` already reflects its GET `amount`.
 */
export function netWorthAfterSaving(fields: FieldState[], rows: BalanceRow[], combinedJpy: number, rate: string): number {
  const rowById = new Map(rows.map((r) => [r.accountId, r]))
  let total = combinedJpy
  for (const f of fields) {
    if (f.text === f.initial) continue
    const row = rowById.get(f.accountId)
    if (!row) continue
    const parsed = parseAmount(f.text, f.currency)
    const newOwn = typeof parsed === 'number' ? parsed : 0
    const oldOwn = row.amount ?? 0
    const newJpy = row.currency === 'JPY' ? newOwn : jpyFromInrPaise(newOwn, rate)
    const oldJpy = row.currency === 'JPY' ? oldOwn : jpyFromInrPaise(oldOwn, rate)
    const delta = newJpy - oldJpy
    total += row.type === 'card' ? -delta : delta
  }
  return total
}
