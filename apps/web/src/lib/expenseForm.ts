import type { Category, NeedWant, PaymentMethod } from '@nri/contracts'
import { jpyFromInrPaise, paiseFromDecimal } from '@nri/core'

export type Currency = 'JPY' | 'INR'
export const PAYMENT_LABELS: Record<PaymentMethod, string> = { bank: 'Bank', cash: 'Cash', credit_card: 'Credit card', ic_card: 'IC card' }
export const NEED_LABELS: Record<NeedWant, string> = { need: 'Need', want: 'Want' }

/** Quick-add defaults: what I used last time in this category (decided with the user), else Bank / Need. */
export function defaultsFor(c: Pick<Category, 'lastPaymentMethod' | 'lastNeedWant'> | undefined) {
  return { paymentMethod: c?.lastPaymentMethod ?? ('bank' as PaymentMethod), needWant: c?.lastNeedWant ?? ('need' as NeedWant) }
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
