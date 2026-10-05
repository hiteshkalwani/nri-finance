import { expect, it } from 'vitest'
import { coercePage, coerceSearch, routeQueryFrom, routeSearchValue, sortFromRoute, toApiQuery, toRestoreInput } from '../src/lib/ledger'
import { SORT_OPTIONS, sortFromValue, sortValue } from '../src/lib/ledger'

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

it('maps the friendly sort options onto sort/dir', () => {
  expect(SORT_OPTIONS.map((o) => o.title)).toEqual(['Newest', 'Oldest', 'Amount high→low', 'Amount low→high', 'Category A→Z', 'Description A→Z'])
  expect(sortFromValue('amountJpy:asc')).toEqual({ key: 'amountJpy', order: 'asc' })
  expect(sortValue({ sort: 'category', dir: 'asc' })).toBe('category:asc')
  expect(sortValue({})).toBe('occurredOn:desc')
})

// Task 6 feeds sortFromValue URL-controlled values; anything not a known SORT_OPTIONS value
// must fall back to the default sort rather than producing an invalid key/order.
it('falls back to the default sort for a value outside SORT_OPTIONS', () => {
  expect(sortFromValue('nonsense')).toEqual({ key: 'occurredOn', order: 'desc' })
  expect(sortFromValue('amountJpy:sideways')).toEqual({ key: 'occurredOn', order: 'desc' })
  expect(sortFromValue('')).toEqual({ key: 'occurredOn', order: 'desc' })
})

// Fix round 1: a junk or out-of-range `page` (URL-fed) must coerce to 1, not reach the API as-is.
it('coerces a junk or out-of-range page to 1', () => {
  expect(coercePage('2')).toBe(2)
  expect(coercePage('abc')).toBe(1)
  expect(coercePage('0')).toBe(1)
  expect(coercePage('-1')).toBe(1)
  expect(coercePage('2.5')).toBe(1)
  expect(coercePage('')).toBe(1)
  expect(coercePage(undefined)).toBe(1)
  expect(coercePage(null)).toBe(1)
  expect(coercePage(['2'])).toBe(1) // a repeated ?page=&page= is a route-array, not a page
})

it('drops a junk/invalid page from the API query instead of forwarding it (the API 400s on it)', () => {
  expect(Object.fromEntries(toApiQuery({ page: 'abc' }))).toEqual({ pageSize: '50' })
  expect(Object.fromEntries(toApiQuery({ page: '0' }))).toEqual({ pageSize: '50' })
  expect(Object.fromEntries(toApiQuery({ page: '-1' }))).toEqual({ pageSize: '50' })
  expect(Object.fromEntries(toApiQuery({ page: '3' }))).toEqual({ page: '3', pageSize: '50' })
})
