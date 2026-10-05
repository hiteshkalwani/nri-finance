import { expect, it } from 'vitest'
import { defaultsFor, parseAmount, previewJpy } from '../src/lib/expenseForm'

it('pre-fills payment method and need/want from the category’s last use, else bank / need', () => {
  expect(defaultsFor({ lastPaymentMethod: 'ic_card', lastNeedWant: 'want' } as never)).toEqual({ paymentMethod: 'ic_card', needWant: 'want' })
  expect(defaultsFor({ lastPaymentMethod: null, lastNeedWant: null } as never)).toEqual({ paymentMethod: 'bank', needWant: 'need' })
  expect(defaultsFor(undefined)).toEqual({ paymentMethod: 'bank', needWant: 'need' })
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
