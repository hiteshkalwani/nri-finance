import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CycleString, ProfileInput, RateString, V1Document } from '../src/index'

describe('primitives', () => {
  it('accepts valid and rejects invalid cycles and rates', () => {
    expect(CycleString.safeParse('2026-09').success).toBe(true)
    expect(CycleString.safeParse('2026-13').success).toBe(false)
    expect(RateString.safeParse('1.694915').success).toBe(true)
    expect(RateString.safeParse('1.6949152').success).toBe(false)
  })
})

describe('ProfileInput', () => {
  it('accepts the workbook profile', () => {
    expect(
      ProfileInput.safeParse({ salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
        .success,
    ).toBe(true)
  })
  it('rejects a start day of 29 and fractional yen', () => {
    const base = { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
    expect(ProfileInput.safeParse({ ...base, cycleStartDay: 29 }).success).toBe(false)
    expect(ProfileInput.safeParse({ ...base, salaryJpy: 1.5 }).success).toBe(false)
  })
})

describe('review fixes: values that used to reach Postgres and 500', () => {
  const base = { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' }
  it('rejects a zero rate and a rate too large for numeric(12,6)', () => {
    expect(RateString.safeParse('0').success).toBe(false)
    expect(RateString.safeParse('0.000000').success).toBe(false)
    expect(RateString.safeParse('10000000').success).toBe(false)
    expect(RateString.safeParse('999999.999999').success).toBe(true)
  })
  it('rejects a salary beyond Postgres integer range', () =>
    expect(ProfileInput.safeParse({ ...base, salaryJpy: 3_000_000_000 }).success).toBe(false))
  it('rejects an unknown timezone', () =>
    expect(ProfileInput.safeParse({ ...base, timezone: 'Mars/Base' }).success).toBe(false))

  const raw = () => JSON.parse(readFileSync(new URL('../../../legacy/seed-data.json', import.meta.url), 'utf8'))
  it('rejects an impossible calendar date in a v1 transaction', () => {
    const doc = raw()
    doc.transactions[0].date = '2026-02-30'
    const r = V1Document.safeParse(doc)
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues[0]!.path).toEqual(['transactions', 0, 'date'])
  })
  it('rejects a malformed cycle and negative targets in v1 cycleTargets', () => {
    const doc = raw()
    doc.cycleTargets = [{ cycle: '2026-13', savingsTargetJPY: 1 }]
    expect(V1Document.safeParse(doc).success).toBe(false)
    doc.cycleTargets = [{ cycle: '2026-10', loanPrepaymentTargetINR: -2.5 }]
    expect(V1Document.safeParse(doc).success).toBe(false)
  })
})

describe('V1Document', () => {
  it('parses the real v1 seed file', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../legacy/seed-data.json', import.meta.url), 'utf8'))
    const r = V1Document.safeParse(raw)
    expect(r.success).toBe(true)
    expect(r.success && r.data.transactions.length).toBe(57)
  })
})
