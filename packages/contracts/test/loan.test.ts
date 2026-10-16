import { describe, expect, it } from 'vitest'
import { LoanInput, LoanPatch, PlannedPrepaymentsInput } from '../src'

const base = { name: 'Home loan', principalPaise: 100_000_000, annualRatePct: '12.000', emiPaise: 2_224_445, tenureMonths: 60, startCycle: '2026-01' }

describe('LoanInput', () => {
  it('accepts a valid loan', () => {
    expect(LoanInput.safeParse(base).success).toBe(true)
  })
  it('rejects an empty or over-long name', () => {
    expect(LoanInput.safeParse({ ...base, name: '' }).success).toBe(false)
    expect(LoanInput.safeParse({ ...base, name: 'x'.repeat(61) }).success).toBe(false)
  })
  it('rejects a non-positive principal or EMI', () => {
    expect(LoanInput.safeParse({ ...base, principalPaise: 0 }).success).toBe(false)
    expect(LoanInput.safeParse({ ...base, emiPaise: -1 }).success).toBe(false)
  })
  it('rejects a rate over 99.999 or badly formatted', () => {
    expect(LoanInput.safeParse({ ...base, annualRatePct: '100.000' }).success).toBe(false)
    expect(LoanInput.safeParse({ ...base, annualRatePct: '12.0001' }).success).toBe(false)
    expect(LoanInput.safeParse({ ...base, annualRatePct: '99.999' }).success).toBe(true)
    expect(LoanInput.safeParse({ ...base, annualRatePct: '0.000' }).success).toBe(true)
  })
  it('rejects tenureMonths out of range', () => {
    expect(LoanInput.safeParse({ ...base, tenureMonths: 0 }).success).toBe(false)
    expect(LoanInput.safeParse({ ...base, tenureMonths: 601 }).success).toBe(false)
    expect(LoanInput.safeParse({ ...base, tenureMonths: 600 }).success).toBe(true)
  })
  it('rejects a bad startCycle and unknown keys', () => {
    expect(LoanInput.safeParse({ ...base, startCycle: '2026-13' }).success).toBe(false)
    expect(LoanInput.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})

describe('LoanPatch', () => {
  it('rejects an empty object', () => {
    expect(LoanPatch.safeParse({}).success).toBe(false)
  })
  it('accepts just `closed`, or any other non-empty subset', () => {
    expect(LoanPatch.safeParse({ closed: true }).success).toBe(true)
    expect(LoanPatch.safeParse({ name: 'Renamed' }).success).toBe(true)
  })
})

describe('PlannedPrepaymentsInput', () => {
  it('accepts an empty list (clearing all planned extras)', () => {
    expect(PlannedPrepaymentsInput.safeParse({ items: [] }).success).toBe(true)
  })
  it('rejects a duplicate monthIndex', () => {
    const r = PlannedPrepaymentsInput.safeParse({ items: [{ monthIndex: 2, amountPaise: 100 }, { monthIndex: 2, amountPaise: 200 }] })
    expect(r.success).toBe(false)
  })
  it('rejects monthIndex < 1 or a non-positive amount', () => {
    expect(PlannedPrepaymentsInput.safeParse({ items: [{ monthIndex: 0, amountPaise: 100 }] }).success).toBe(false)
    expect(PlannedPrepaymentsInput.safeParse({ items: [{ monthIndex: 1, amountPaise: 0 }] }).success).toBe(false)
  })
})
