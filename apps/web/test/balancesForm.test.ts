import { describe, expect, it } from 'vitest'
import type { BalanceRow } from '@nri/contracts'
import { jpyFromInrPaise } from '@nri/core'
import { changedEntries, type FieldState, formatGrouped, isDirty, netWorthAfterSaving, parseAmount, toText } from '../src/lib/balancesForm'

const RATE = '1.694915'

function row(overrides: Partial<BalanceRow> & { accountId: string }): BalanceRow {
  return {
    name: 'Account',
    country: 'JP',
    currency: 'JPY',
    type: 'bank',
    isEmergencyFund: false,
    amount: null,
    source: 'none',
    fromCycle: null,
    ...overrides,
  }
}

function field(overrides: Partial<FieldState> & { accountId: string; currency: 'JPY' | 'INR' }): FieldState {
  return { text: '', initial: '', ...overrides }
}

describe('toText', () => {
  it('formats a ¥ amount as a plain integer string, and null as blank', () => {
    expect(toText(500000, 'JPY')).toBe('500000')
    expect(toText(null, 'JPY')).toBe('')
  })
  it('formats ₹ paise as a decimal rupee string, and null as blank', () => {
    expect(toText(1234567, 'INR')).toBe('12345.67')
    expect(toText(null, 'INR')).toBe('')
  })
})

describe('parseAmount', () => {
  it('blank text means nothing entered', () => {
    expect(parseAmount('', 'JPY')).toBeNull()
    expect(parseAmount('   ', 'INR')).toBeNull()
  })
  it('¥ accepts whole yen, commas included', () => {
    expect(parseAmount('500000', 'JPY')).toBe(500000)
    expect(parseAmount('12,345', 'JPY')).toBe(12345)
  })
  it('¥ rejects a decimal amount', () => {
    expect(parseAmount('1.5', 'JPY')).toBe('invalid')
  })
  it('₹ accepts up to 2 decimals, commas included', () => {
    expect(parseAmount('12,345.67', 'INR')).toBe(1234567)
    expect(parseAmount('500', 'INR')).toBe(50000)
  })
  it('₹ rejects more than 2 decimals', () => {
    expect(parseAmount('12.345', 'INR')).toBe('invalid')
  })
  it('rejects a negative amount in either currency', () => {
    expect(parseAmount('-500', 'JPY')).toBe('invalid')
    expect(parseAmount('-5.00', 'INR')).toBe('invalid')
  })
  it('rejects non-numeric text', () => {
    expect(parseAmount('abc', 'JPY')).toBe('invalid')
    expect(parseAmount('12.', 'INR')).toBe('invalid')
  })
})

describe('formatGrouped', () => {
  it('groups a ¥ amount with thousands separators', () => {
    expect(formatGrouped(1240000, 'JPY')).toBe('1,240,000')
    expect(formatGrouped(0, 'JPY')).toBe('0')
  })
  it('groups a ₹ amount (given in paise) with Indian lakh/crore separators and 2 decimals', () => {
    expect(formatGrouped(40670000, 'INR')).toBe('4,06,700.00')
    expect(formatGrouped(100000000, 'INR')).toBe('10,00,000.00')
  })
})

describe('changedEntries', () => {
  it('skips a "this"-cycle row whose text was never touched', () => {
    const rows = [row({ accountId: 'a1', amount: 500000, source: 'this' })]
    const fields = [field({ accountId: 'a1', currency: 'JPY', text: '500000', initial: '500000' })]
    expect(changedEntries(fields, rows)).toEqual([])
  })
  it('includes a carried row even when its text was left untouched (confirms the carried value)', () => {
    const rows = [row({ accountId: 'a2', amount: 2000000, source: 'carried', fromCycle: '2026-09' })]
    const fields = [field({ accountId: 'a2', currency: 'JPY', text: '2000000', initial: '2000000' })]
    expect(changedEntries(fields, rows)).toEqual([{ accountId: 'a2', amount: 2000000 }])
  })
  it('skips a blank field even for a "none"-source row', () => {
    const rows = [row({ accountId: 'a3', amount: null, source: 'none' })]
    const fields = [field({ accountId: 'a3', currency: 'JPY', text: '', initial: '' })]
    expect(changedEntries(fields, rows)).toEqual([])
  })
  it('includes a "none"-source row once the user types a value', () => {
    const rows = [row({ accountId: 'a3', amount: null, source: 'none' })]
    const fields = [field({ accountId: 'a3', currency: 'JPY', text: '500', initial: '' })]
    expect(changedEntries(fields, rows)).toEqual([{ accountId: 'a3', amount: 500 }])
  })
  it('includes a "this"-cycle row the user edited, with the newly parsed amount', () => {
    const rows = [row({ accountId: 'a4', amount: 500000, source: 'this' })]
    const fields = [field({ accountId: 'a4', currency: 'JPY', text: '510000', initial: '500000' })]
    expect(changedEntries(fields, rows)).toEqual([{ accountId: 'a4', amount: 510000 }])
  })
  it('skips a field the user cleared to blank, even though that counts as "edited"', () => {
    const rows = [row({ accountId: 'a5', amount: 500000, source: 'this' })]
    const fields = [field({ accountId: 'a5', currency: 'JPY', text: '', initial: '500000' })]
    expect(changedEntries(fields, rows)).toEqual([])
  })
  it('skips a field that cannot be parsed', () => {
    const rows = [row({ accountId: 'a6', amount: 500000, source: 'this' })]
    const fields = [field({ accountId: 'a6', currency: 'JPY', text: '1.5', initial: '500000' })]
    expect(changedEntries(fields, rows)).toEqual([])
  })
  // Fix round 1 (coordinator finding 2): blur-formatting re-displays a field's own unchanged value
  // with commas — that must never look like an edit just because the *text* differs from `initial`.
  it('does not include a "this"-cycle row re-typed (or re-displayed) with the same value in a different format', () => {
    const rows = [row({ accountId: 'a1', amount: 1240000, source: 'this' })]
    const fields = [field({ accountId: 'a1', currency: 'JPY', text: '1,240,000', initial: '1240000' })]
    expect(changedEntries(fields, rows)).toEqual([])
  })
})

describe('isDirty', () => {
  it('is false when every field still matches its prefilled text', () => {
    const fields = [
      field({ accountId: 'a1', currency: 'JPY', text: '500000', initial: '500000' }),
      field({ accountId: 'a2', currency: 'INR', text: '', initial: '' }),
    ]
    expect(isDirty(fields)).toBe(false)
  })
  it('is true once any field no longer matches its prefilled text', () => {
    const fields = [
      field({ accountId: 'a1', currency: 'JPY', text: '500000', initial: '500000' }),
      field({ accountId: 'a2', currency: 'INR', text: '100.00', initial: '' }),
    ]
    expect(isDirty(fields)).toBe(true)
  })
  // Fix round 1 (coordinator finding 2): compares *parsed* amounts, not raw text — blur-formatting
  // a field (adding commas) must never make an otherwise-untouched field look dirty.
  it('is not dirty when a field\'s text differs only in formatting (commas), same parsed value', () => {
    const fields = [field({ accountId: 'a1', currency: 'JPY', text: '1,240,000', initial: '1240000' })]
    expect(isDirty(fields)).toBe(false)
  })
})

describe('netWorthAfterSaving', () => {
  const COMBINED = 1949069

  it('is unchanged when no field was edited', () => {
    const rows = [row({ accountId: 'a1', amount: 500000, source: 'this' })]
    const fields = [field({ accountId: 'a1', currency: 'JPY', text: '500000', initial: '500000' })]
    expect(netWorthAfterSaving(fields, rows, COMBINED, RATE)).toBe(COMBINED)
  })

  it('subtracts a card row\'s increase in what is owed (a liability)', () => {
    const rows = [row({ accountId: 'c1', amount: 1000, source: 'this', type: 'card' })]
    const fields = [field({ accountId: 'c1', currency: 'JPY', text: '2000', initial: '1000' })]
    expect(netWorthAfterSaving(fields, rows, COMBINED, RATE)).toBe(COMBINED - 1000)
  })

  it('adds a card row\'s decrease in what is owed', () => {
    const rows = [row({ accountId: 'c2', amount: 2000, source: 'this', type: 'card' })]
    const fields = [field({ accountId: 'c2', currency: 'JPY', text: '500', initial: '2000' })]
    expect(netWorthAfterSaving(fields, rows, COMBINED, RATE)).toBe(COMBINED + 1500)
  })

  it('converts a ₹ row\'s old and new amounts separately at the planning rate', () => {
    const rows = [row({ accountId: 'r1', amount: 100000, source: 'this', country: 'IN', currency: 'INR' })]
    const fields = [field({ accountId: 'r1', currency: 'INR', text: '2000.00', initial: '1000.00' })]
    const expectedDelta = jpyFromInrPaise(200000, RATE) - jpyFromInrPaise(100000, RATE)
    expect(netWorthAfterSaving(fields, rows, COMBINED, RATE)).toBe(COMBINED + expectedDelta)
  })

  // Fix round 1 (coordinator finding 3): the controller ruling is that a blank field means "keep
  // the current value" — Save doesn't send it, and the live preview must not act as though it
  // were about to be zeroed either. (Previously this asserted `COMBINED - 500000`.)
  it('treats a field cleared to blank as unchanged — "keep the current value" — not a drop to 0', () => {
    const rows = [row({ accountId: 'a5', amount: 500000, source: 'this' })]
    const fields = [field({ accountId: 'a5', currency: 'JPY', text: '', initial: '500000' })]
    expect(netWorthAfterSaving(fields, rows, COMBINED, RATE)).toBe(COMBINED)
  })

  it('leaves an untouched blank field (no prior balance, still blank) contributing nothing', () => {
    const rows = [row({ accountId: 'a6', amount: null, source: 'none' })]
    const fields = [field({ accountId: 'a6', currency: 'JPY', text: '', initial: '' })]
    expect(netWorthAfterSaving(fields, rows, COMBINED, RATE)).toBe(COMBINED)
  })

  // Fix round 1 (coordinator finding 2): same reasoning as isDirty/changedEntries above — a
  // formatting-only difference (commas) must not register as an edit here either.
  it('is unchanged when a field is re-typed (or re-displayed) with the same value in a different format', () => {
    const rows = [row({ accountId: 'a1', amount: 500000, source: 'this' })]
    const fields = [field({ accountId: 'a1', currency: 'JPY', text: '500,000', initial: '500000' })]
    expect(netWorthAfterSaving(fields, rows, COMBINED, RATE)).toBe(COMBINED)
  })
})
