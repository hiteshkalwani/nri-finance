import { describe, expect, it, vi } from 'vitest'
import type { Targets, TargetRow } from '@nri/contracts'

// targetsForm.ts's useCopyPreviousTargets imports lib/api.ts, which imports lib/supabase.ts —
// same mock every other test that touches lib/api.ts needs, so this file passes with no .env.local.
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
import { rupees, yen } from '../src/lib/format'
import {
  hasInvalidTargetField, isDirtyTargets, targetFieldsFrom, targetsPutFrom, targetStateText, type TargetFields,
} from '../src/lib/targetsForm'

const EMPTY_TARGETS: Targets = { cycle: '2026-10', savingsJpy: null, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null }

describe('targetFieldsFrom', () => {
  it('blank text for an unset target, plain numbers for ¥ fields', () => {
    const f = targetFieldsFrom({ ...EMPTY_TARGETS, savingsJpy: 300000, remittanceJpy: 150000 })
    expect(f.savings).toBe('300000')
    expect(f.remittance).toBe('150000')
    expect(f.emergencyFund).toBe('')
    expect(f.prepayment).toBe('')
  })
  it('a decimal rupee string for the prepayment field (paise -> decimal)', () => {
    const f = targetFieldsFrom({ ...EMPTY_TARGETS, prepaymentPaise: 5000000 })
    expect(f.prepayment).toBe('50000.00')
  })
})

describe('targetsPutFrom', () => {
  const fields: TargetFields = { savings: '300000', emergencyFund: '', remittance: '150000', prepayment: '50000' }
  it('builds the full-replace body, blank -> null', () => {
    expect(targetsPutFrom(fields)).toEqual({
      savingsJpy: 300000, emergencyFundJpy: null, remittanceJpy: 150000, prepaymentPaise: 5000000,
    })
  })
  it('is null when any field is unparsable', () => {
    expect(targetsPutFrom({ ...fields, savings: 'abc' })).toBeNull()
  })
})

describe('hasInvalidTargetField / isDirtyTargets', () => {
  const base: TargetFields = { savings: '300000', emergencyFund: '', remittance: '150000', prepayment: '50000' }
  it('flags an unparsable field', () => {
    expect(hasInvalidTargetField({ ...base, remittance: 'abc' })).toBe(true)
    expect(hasInvalidTargetField(base)).toBe(false)
  })
  it('is dirty only once a field differs by value from its initial', () => {
    expect(isDirtyTargets(base, { ...base })).toBe(false)
    expect(isDirtyTargets({ ...base, savings: '350000' }, base)).toBe(true)
  })
})

describe('targetStateText', () => {
  const metRow: TargetRow = { key: 'savings', targetValue: 300000, actualValue: 337660, diff: 37660, met: true }
  const shortRow: TargetRow = { key: 'emergencyFund', targetValue: 50000, actualValue: 40000, diff: -10000, met: false }
  const metExactly: TargetRow = { key: 'remittance', targetValue: 150000, actualValue: 150000, diff: 0, met: true }
  it('shows "✓ Met · +<surplus>" when over target', () => {
    expect(targetStateText(metRow, yen)).toBe('✓ Met · +￥37,660')
  })
  it('shows plain "✓ Met" when exactly on target', () => {
    expect(targetStateText(metExactly, yen)).toBe('✓ Met')
  })
  it('shows "✗ <shortfall> short" when under target', () => {
    expect(targetStateText(shortRow, yen)).toBe('✗ ￥10,000 short')
  })
  it('formats the prepayment target in rupees', () => {
    const prepay: TargetRow = { key: 'prepayment', targetValue: 5000000, actualValue: 2000000, diff: -3000000, met: false }
    expect(targetStateText(prepay, rupees)).toBe('✗ ₹30,000.00 short')
  })
})
