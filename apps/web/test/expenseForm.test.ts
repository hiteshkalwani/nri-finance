import { expect, it } from 'vitest'
import { amountPatchFor, defaultsFor, lastUsedNeedWantHint, lastUsedPaymentHint, parseAmount, previewJpy } from '../src/lib/expenseForm'

it('pre-fills payment method and need/want from the category’s last use, else bank / need', () => {
  expect(defaultsFor({ lastPaymentMethod: 'ic_card', lastNeedWant: 'want' } as never)).toEqual({ paymentMethod: 'ic_card', needWant: 'want' })
  expect(defaultsFor({ lastPaymentMethod: null, lastNeedWant: null } as never)).toEqual({ paymentMethod: 'bank', needWant: 'need' })
  expect(defaultsFor(undefined)).toEqual({ paymentMethod: 'bank', needWant: 'need' })
})

it('hints "last used for <category>" only when the current chip matches the category’s own last use', () => {
  const groceries = { name: 'Groceries', lastPaymentMethod: 'ic_card' as const, lastNeedWant: 'need' as const }
  expect(lastUsedPaymentHint(groceries, 'ic_card')).toBe('Groceries')
  expect(lastUsedPaymentHint(groceries, 'cash')).toBeNull()
  expect(lastUsedPaymentHint({ name: 'New', lastPaymentMethod: null }, 'bank')).toBeNull()
  expect(lastUsedPaymentHint(undefined, 'bank')).toBeNull()

  expect(lastUsedNeedWantHint(groceries, 'need')).toBe('Groceries')
  expect(lastUsedNeedWantHint(groceries, 'want')).toBeNull()
})

it('reads ¥ as whole numbers and ₹ with up to two decimals', () => {
  expect(parseAmount('1,280', 'JPY')).toEqual({ amountJpy: 1280 })
  expect(parseAmount('12.5', 'JPY')).toBeNull()
  expect(parseAmount('0', 'JPY')).toBeNull()
  expect(parseAmount('1000.5', 'INR')).toEqual({ amountInrPaise: 100050 })
  expect(parseAmount('1.234', 'INR')).toBeNull()
  expect(parseAmount('', 'INR')).toBeNull()
})

it('previews the ¥ amount for a ₹ entry at the planning rate', () => {
  expect(previewJpy('1000', '1.694915')).toBe(1695)
  expect(previewJpy('abc', '1.694915')).toBeNull()
})

// TXN-4: an unchanged ₹ row must not be re-converted at today's rate, so a resubmit with no edits sends no amount.
it('sends no amount for an unchanged ₹ row, the amount when it changed, and the amount on a currency switch', () => {
  const inr = { enteredCurrency: 'INR' as const, amountJpy: 1695, amountInrPaise: 100000 }
  expect(amountPatchFor(inr, 'INR', { amountInrPaise: 100000 })).toEqual({})
  expect(amountPatchFor(inr, 'INR', { amountInrPaise: 100100 })).toEqual({ amountInrPaise: 100100 })
  expect(amountPatchFor(inr, 'JPY', { amountJpy: 1695 })).toEqual({ amountJpy: 1695 })

  const jpy = { enteredCurrency: 'JPY' as const, amountJpy: 1280, amountInrPaise: null }
  expect(amountPatchFor(jpy, 'JPY', { amountJpy: 1280 })).toEqual({})
  expect(amountPatchFor(jpy, 'JPY', { amountJpy: 1281 })).toEqual({ amountJpy: 1281 })
  expect(amountPatchFor(jpy, 'INR', { amountInrPaise: 100000 })).toEqual({ amountInrPaise: 100000 })
})
