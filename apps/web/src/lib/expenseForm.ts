import type { Category, NeedWant, PaymentMethod, Transaction } from '@nri/contracts'
import { jpyFromInrPaise, paiseFromDecimal } from '@nri/core'

export type Currency = 'JPY' | 'INR'
export const PAYMENT_LABELS: Record<PaymentMethod, string> = { bank: 'Bank', cash: 'Cash', credit_card: 'Credit card', ic_card: 'IC card' }
export const NEED_LABELS: Record<NeedWant, string> = { need: 'Need', want: 'Want' }

/** Quick-add defaults: what I used last time in this category (decided with the user), else Bank / Need. */
export function defaultsFor(c: Pick<Category, 'lastPaymentMethod' | 'lastNeedWant'> | undefined) {
  return { paymentMethod: c?.lastPaymentMethod ?? ('bank' as PaymentMethod), needWant: c?.lastNeedWant ?? ('need' as NeedWant) }
}

/**
 * Quick-add's "· last used for <category>" hint (spec §4.3): the category's name when the chip
 * row's current value is that category's own last-used value (whether `defaultsFor` just set it or
 * the user picked the same one), else null.
 */
export function lastUsedPaymentHint(c: Pick<Category, 'name' | 'lastPaymentMethod'> | undefined, current: PaymentMethod): string | null {
  return c?.lastPaymentMethod != null && c.lastPaymentMethod === current ? c.name : null
}

/** Same as `lastUsedPaymentHint`, for the need/want row. */
export function lastUsedNeedWantHint(c: Pick<Category, 'name' | 'lastNeedWant'> | undefined, current: NeedWant): string | null {
  return c?.lastNeedWant != null && c.lastNeedWant === current ? c.name : null
}

/** ¥: whole numbers (commas allowed). ₹: up to two decimals, sent as paise. Null when not a positive amount. */
export function parseAmount(text: string, currency: Currency): { amountJpy: number } | { amountInrPaise: number } | null {
  const s = text.replace(/,/g, '').trim()
  if (currency === 'JPY') {
    if (!/^\d+$/.test(s)) return null
    const n = Number(s)
    return n > 0 && Number.isSafeInteger(n) ? { amountJpy: n } : null
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const paise = paiseFromDecimal(s)
  return paise > 0 ? { amountInrPaise: paise } : null
}

export function previewJpy(text: string, rate: string): number | null {
  const a = parseAmount(text, 'INR')
  return a && 'amountInrPaise' in a ? jpyFromInrPaise(a.amountInrPaise, rate) : null
}

/**
 * The amount fields to send in an edit PATCH: none when the currency and parsed amount are both
 * unchanged from the row being edited (TXN-4) — an unchanged ₹ amount must not be re-converted at
 * today's planning rate — otherwise the parsed amount, so a currency switch or a real change is sent.
 */
export function amountPatchFor(
  original: Pick<Transaction, 'enteredCurrency' | 'amountJpy' | 'amountInrPaise'>,
  currency: Currency,
  parsed: { amountJpy: number } | { amountInrPaise: number },
): { amountJpy: number } | { amountInrPaise: number } | Record<string, never> {
  const unchanged = currency === original.enteredCurrency &&
    ('amountJpy' in parsed ? parsed.amountJpy === original.amountJpy : parsed.amountInrPaise === original.amountInrPaise)
  return unchanged ? {} : parsed
}
