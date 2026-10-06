import { describe, expect, it } from 'vitest'
import { AccountCreate, AccountPatch, currencyFor } from '../src'

describe('AccountCreate', () => {
  it('rejects a currency key (strict)', () => {
    expect(AccountCreate.safeParse({ name: 'HDFC', country: 'IN', type: 'bank', currency: 'INR' }).success).toBe(false)
  })
  it('rejects empty and over-long names', () => {
    expect(AccountCreate.safeParse({ name: '', country: 'IN', type: 'bank' }).success).toBe(false)
    expect(AccountCreate.safeParse({ name: '   ', country: 'IN', type: 'bank' }).success).toBe(false)
    expect(AccountCreate.safeParse({ name: 'x'.repeat(61), country: 'IN', type: 'bank' }).success).toBe(false)
    expect(AccountCreate.safeParse({ name: 'x'.repeat(60), country: 'IN', type: 'bank' }).success).toBe(true)
  })
  it('rejects an unknown type', () => {
    expect(AccountCreate.safeParse({ name: 'HDFC', country: 'IN', type: 'crypto' }).success).toBe(false)
  })
  it('accepts a valid create, isEmergencyFund optional', () => {
    expect(AccountCreate.safeParse({ name: 'HDFC', country: 'IN', type: 'bank' }).success).toBe(true)
    expect(AccountCreate.safeParse({ name: 'HDFC', country: 'IN', type: 'bank', isEmergencyFund: true }).success).toBe(true)
  })
})

describe('AccountPatch', () => {
  it('rejects an empty object', () => {
    expect(AccountPatch.safeParse({}).success).toBe(false)
  })
  it('accepts any non-empty subset and rejects unknown keys', () => {
    expect(AccountPatch.safeParse({ archived: true }).success).toBe(true)
    expect(AccountPatch.safeParse({ name: 'New name' }).success).toBe(true)
    expect(AccountPatch.safeParse({ currency: 'INR' }).success).toBe(false)
  })
})

describe('currencyFor', () => {
  it('derives currency from country', () => {
    expect(currencyFor('IN')).toBe('INR')
    expect(currencyFor('JP')).toBe('JPY')
  })
})
