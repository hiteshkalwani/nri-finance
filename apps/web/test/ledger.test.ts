import { expect, it } from 'vitest'
import { routeQueryFrom, sortFromRoute, toApiQuery, toCreateInput } from '../src/lib/ledger'

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

it('rebuilds a create body from a deleted row for Undo, in the currency it was entered in', () => {
  const t = {
    id: 'x', occurredOn: '2026-10-01', cycle: '2026-10', categoryId: 'c', accountId: null, description: 'd', amountJpy: 1695,
    enteredCurrency: 'INR', amountInrPaise: 100000, rateUsed: '1.694915', paymentMethod: 'cash', needWant: 'need', notes: '',
  } as const
  expect(toCreateInput(t)).toEqual({ occurredOn: '2026-10-01', categoryId: 'c', accountId: null, description: 'd', notes: '', paymentMethod: 'cash', needWant: 'need', amountInrPaise: 100000 })
  expect(toCreateInput({ ...t, enteredCurrency: 'JPY', amountInrPaise: null })).toMatchObject({ amountJpy: 1695 })
})
