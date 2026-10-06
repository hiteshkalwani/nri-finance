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
 * The entries to PUT: every field with a non-empty, validly-parsed amount that either differs in
 * *value* from its prefilled `initial` text (the user actually typed a different amount — a
 * formatting-only difference, e.g. blur adding commas, never counts, fix round 1), or whose GET
 * row came from a cycle other than this one ('carried'/'none') — saving confirms that carried
 * (or, once typed, brand new) value as this cycle's own snapshot even when the user left the
 * prefilled text untouched. A blank field, or one `parseAmount` can't parse, is skipped either way.
 */
export function changedEntries(fields: FieldState[], rows: BalanceRow[]): { accountId: string; amount: number }[] {
  const rowById = new Map(rows.map((r) => [r.accountId, r]))
  const out: { accountId: string; amount: number }[] = []
  for (const f of fields) {
    const parsed = parseAmount(f.text, f.currency)
    if (typeof parsed !== 'number') continue
    const row = rowById.get(f.accountId)
    const edited = parsed !== parseAmount(f.initial, f.currency)
    const confirmsCarried = row !== undefined && row.source !== 'this'
    if (edited || confirmsCarried) out.push({ accountId: f.accountId, amount: parsed })
  }
  return out
}

/**
 * True once any field's *parsed* amount no longer matches what it was prefilled with — compares
 * values, not raw text (fix round 1), so re-displaying a field with grouped/comma formatting (or
 * a user literally retyping the same amount with different commas) is never "dirty" on its own.
 */
export function isDirty(fields: FieldState[]): boolean {
  return fields.some((f) => parseAmount(f.text, f.currency) !== parseAmount(f.initial, f.currency))
}

const JPY_GROUP = new Intl.NumberFormat('ja-JP')
const INR_GROUP = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * `amount` (yen for JPY, paise for INR — same convention as `parseAmount`'s return) with
 * thousands/lakh grouping, for display while a field isn't focused (fix round 1): ¥ "1,240,000",
 * ₹ "4,06,700.00" (en-IN grouping, matching `rupees()`'s own locale).
 */
export function formatGrouped(amount: number, currency: Currency): string {
  return currency === 'JPY' ? JPY_GROUP.format(amount) : INR_GROUP.format(amount / 100)
}

/**
 * Live "net worth after saving" for the sticky footer (controller ruling, Task 8; fix round 1
 * corrects the blank-field case and makes "edited" value-based, not text-based): the cycle's
 * current combined ¥ net worth, adjusted by every field whose *parsed* amount actually differs
 * from its prefilled `initial`'s parsed amount — so blur-formatting a field (adding commas) or a
 * user retyping the identical amount never perturbs the preview — by that field's own signed ¥
 * delta (the difference between what it would save as and the GET row's own `amount`), rather
 * than recomputing net worth from scratch client-side. A card account's delta is subtracted (more
 * owed is worse); a ₹ account's old and new amounts are each converted to ¥ at `rate`
 * separately — both are already non-negative (`BalanceRow.amount` is never negative; `parseAmount`
 * rejects negative text as `'invalid'`) — and only then differenced, rather than netting the paise
 * first. A field cleared to blank means "keep the current value" (the controller ruling): it
 * contributes nothing, exactly like an untouched field, since nothing will actually change for
 * that account. An edited-but-unparsable (not blank) field counts as 0 — "as if saved empty" —
 * which only matters while Save stays disabled for it.
 */
export function netWorthAfterSaving(fields: FieldState[], rows: BalanceRow[], combinedJpy: number, rate: string): number {
  const rowById = new Map(rows.map((r) => [r.accountId, r]))
  let total = combinedJpy
  for (const f of fields) {
    const parsed = parseAmount(f.text, f.currency)
    if (parsed === parseAmount(f.initial, f.currency)) continue // unedited, by value
    if (parsed === null) continue // blank — "keep the current value", nothing to preview
    const row = rowById.get(f.accountId)
    if (!row) continue
    const newOwn = typeof parsed === 'number' ? parsed : 0
    const oldOwn = row.amount ?? 0
    const newJpy = row.currency === 'JPY' ? newOwn : jpyFromInrPaise(newOwn, rate)
    const oldJpy = row.currency === 'JPY' ? oldOwn : jpyFromInrPaise(oldOwn, rate)
    const delta = newJpy - oldJpy
    total += row.type === 'card' ? -delta : delta
  }
  return total
}
