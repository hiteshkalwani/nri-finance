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

describe('V1Document', () => {
  it('parses the real v1 seed file', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../legacy/seed-data.json', import.meta.url), 'utf8'))
    const r = V1Document.safeParse(raw)
    expect(r.success).toBe(true)
    expect(r.success && r.data.transactions.length).toBe(57)
  })
})
