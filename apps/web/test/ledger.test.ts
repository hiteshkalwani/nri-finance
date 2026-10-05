import { expect, it } from 'vitest'
import { coerceSearch, routeQueryFrom, routeSearchValue, sortFromRoute, toApiQuery, toRestoreInput } from '../src/lib/ledger'

it('maps the page URL to API query params, dropping empty values', () => {
  const p = toApiQuery({ cycle: '2026-10', categoryId: '', q: 'lunch', sort: 'amountJpy', dir: 'asc', page: '2' })
  expect(Object.fromEntries(p)).toEqual({ cycle: '2026-10', q: 'lunch', sort: 'amountJpy', dir: 'asc', page: '2', pageSize: '50' })
})

it('round-trips table state through the URL', () => {
  const q = routeQueryFrom({ cycle: '2026-10', categoryId: null, paymentMethod: 'cash', needWant: null, q: '', sort: { key: 'amountJpy', order: 'asc' }, page: 1 })
  expect(q).toEqual({ cycle: '2026-10', paymentMethod: 'cash', sort: 'amountJpy', dir: 'asc' })
  expect(sortFromRoute(q)).toEqual([{ key: 'amountJpy', order: 'asc' }])
  expect(sortFromRoute({})).toEqual([{ key: 'occurredOn', order: 'desc' }])
})

// I1: Vuetify 4.2.3's clearable × sets the search field's v-model to `null`, not ''.
it('coerces a null search value (Vuetify clear) to empty', () => {
  expect(coerceSearch(null)).toBe('')
  expect(coerceSearch(undefined)).toBe('')
  expect(coerceSearch('lunch')).toBe('lunch')
})

it('never crashes on a null q, and drops it from the URL like an empty search (I1)', () => {
  const base = { cycle: null, categoryId: null, paymentMethod: null, needWant: null, sort: { key: 'occurredOn' as const, order: 'desc' as const }, page: 1 }
  expect(routeQueryFrom({ ...base, q: null as unknown as string })).toEqual({})
  expect(routeQueryFrom({ ...base, q: '' })).toEqual({})
  expect(routeQueryFrom({ ...base, q: '  ' })).toEqual({})
  expect(routeQueryFrom({ ...base, q: 'lunch' })).toEqual({ q: 'lunch' })
})

it('rebuilds a restore body from a deleted row for Undo, with the original ¥/₹/rate verbatim (I2)', () => {
  const inr = {
    id: 'x', occurredOn: '2026-10-01', cycle: '2026-10', categoryId: 'c', accountId: null, description: 'd', amountJpy: 1695,
    enteredCurrency: 'INR', amountInrPaise: 100000, rateUsed: '1.694915', paymentMethod: 'cash', needWant: 'need', notes: '',
  } as const
  expect(toRestoreInput(inr)).toEqual({
    occurredOn: '2026-10-01', categoryId: 'c', accountId: null, description: 'd', notes: '', paymentMethod: 'cash', needWant: 'need',
    amountJpy: 1695, enteredCurrency: 'INR', amountInrPaise: 100000, rateUsed: '1.694915',
  })
  const jpy = { ...inr, enteredCurrency: 'JPY' as const, amountInrPaise: null, rateUsed: null }
  expect(toRestoreInput(jpy)).toEqual({
    occurredOn: '2026-10-01', categoryId: 'c', accountId: null, description: 'd', notes: '', paymentMethod: 'cash', needWant: 'need',
    amountJpy: 1695, enteredCurrency: 'JPY', amountInrPaise: null, rateUsed: null,
  })
})

it('reads the search box value from the URL, treating a missing/non-string q as empty', () => {
  expect(routeSearchValue('lunch')).toBe('lunch')
  expect(routeSearchValue(undefined)).toBe('')
  expect(routeSearchValue(null)).toBe('')
  expect(routeSearchValue(['lunch'])).toBe('')
})
