import { describe, expect, it } from 'vitest'
import { CategoryCreate, CategoryOrder, CategoryPatch, ErrorCode, TransactionCreate, TransactionPatch, TransactionQuery, TransactionRestore } from '../src'

const base = { occurredOn: '2026-10-05', categoryId: '11111111-1111-4111-8111-111111111111', paymentMethod: 'cash', needWant: 'need' }

describe('categories', () => {
  it('trims names and requires a #RRGGBB colour', () => {
    expect(CategoryCreate.parse({ name: '  Groceries ', color: '#4caf50' })).toEqual({ name: 'Groceries', color: '#4caf50' })
    expect(CategoryCreate.safeParse({ name: 'x', color: 'green' }).success).toBe(false)
    expect(CategoryCreate.safeParse({ name: '   ', color: '#000000' }).success).toBe(false)
    expect(CategoryCreate.safeParse({ name: 'x'.repeat(41), color: '#000000' }).success).toBe(false)
  })
  it('patch needs at least one field and rejects unknown ones', () => {
    expect(CategoryPatch.safeParse({}).success).toBe(false)
    expect(CategoryPatch.safeParse({ archived: true }).success).toBe(true)
    expect(CategoryPatch.safeParse({ sortOrder: 3 }).success).toBe(false)
  })
  it('order takes uuids', () => {
    expect(CategoryOrder.safeParse({ ids: ['nope'] }).success).toBe(false)
  })
})

describe('transactions', () => {
  it('takes exactly one of ¥ or ₹ (TXN-4)', () => {
    expect(TransactionCreate.safeParse({ ...base, amountJpy: 1280 }).success).toBe(true)
    expect(TransactionCreate.safeParse({ ...base, amountInrPaise: 50000 }).success).toBe(true)
    expect(TransactionCreate.safeParse({ ...base }).success).toBe(false)
    expect(TransactionCreate.safeParse({ ...base, amountJpy: 1, amountInrPaise: 1 }).success).toBe(false)
  })
  it('rejects zero, fractions, out-of-range amounts and over-long text', () => {
    for (const amountJpy of [0, 1.5, -3, 3_000_000_000]) expect(TransactionCreate.safeParse({ ...base, amountJpy }).success).toBe(false)
    expect(TransactionCreate.safeParse({ ...base, amountJpy: 1, description: 'x'.repeat(201) }).success).toBe(false)
    expect(TransactionCreate.safeParse({ ...base, amountJpy: 1, notes: 'x'.repeat(2001) }).success).toBe(false)
    expect(TransactionCreate.safeParse({ ...base, amountJpy: 1, occurredOn: '2026-02-30' }).success).toBe(false)
  })
  it('patch: any subset, but never both amounts and never empty', () => {
    expect(TransactionPatch.safeParse({ description: 'x' }).success).toBe(true)
    expect(TransactionPatch.safeParse({ amountJpy: 1, amountInrPaise: 1 }).success).toBe(false)
    expect(TransactionPatch.safeParse({}).success).toBe(false)
  })
  it('query: defaults, coercion and limits', () => {
    expect(TransactionQuery.parse({})).toMatchObject({ sort: 'occurredOn', dir: 'desc', page: 1, pageSize: 50 })
    expect(TransactionQuery.parse({ page: '2', pageSize: '200' })).toMatchObject({ page: 2, pageSize: 200 })
    expect(TransactionQuery.safeParse({ pageSize: '201' }).success).toBe(false)
    expect(TransactionQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false)
    expect(TransactionQuery.safeParse({ sort: 'userId' }).success).toBe(false)
    expect(TransactionQuery.safeParse({ cycle: '2026-13' }).success).toBe(false)
  })
  it('restore: rateUsed must be a positive rate string with up to 6 digits each side, or null for JPY', () => {
    const restoreBase = {
      ...base, accountId: null, description: 'x', notes: '', amountJpy: 500,
      enteredCurrency: 'INR' as const, amountInrPaise: 100,
    }
    expect(TransactionRestore.safeParse({ ...restoreBase, rateUsed: '1.694915' }).success).toBe(true)
    for (const rateUsed of ['0', '-1.5', 'abc', '0.0', '1234567', '1.1234567']) {
      expect(TransactionRestore.safeParse({ ...restoreBase, rateUsed }).success).toBe(false)
    }
    expect(TransactionRestore.safeParse({
      ...base, accountId: null, description: 'x', notes: '', amountJpy: 500,
      enteredCurrency: 'JPY' as const, amountInrPaise: null, rateUsed: null,
    }).success).toBe(true)
  })
})

it('has an error code for an unreachable sign-in service', () => {
  expect(ErrorCode.options).toContain('AUTH_UNAVAILABLE')
})
