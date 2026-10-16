import { describe, expect, it } from 'vitest'
import { PAISE_MAX, PG_INT_MAX, Targets, TargetsPut } from '../src'

const full = { savingsJpy: 300_000, emergencyFundJpy: 20_000, remittanceJpy: 100_000, prepaymentPaise: 5_000_00 }

describe('TargetsPut', () => {
  it('accepts all four targets set, and all four null', () => {
    expect(TargetsPut.safeParse(full).success).toBe(true)
    expect(TargetsPut.safeParse({ savingsJpy: null, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null }).success).toBe(true)
  })

  it('requires every key (full replace, not a patch)', () => {
    const partial = { emergencyFundJpy: full.emergencyFundJpy, remittanceJpy: full.remittanceJpy, prepaymentPaise: full.prepaymentPaise }
    expect(TargetsPut.safeParse(partial).success).toBe(false)
  })

  it('rejects a negative value', () => {
    expect(TargetsPut.safeParse({ ...full, savingsJpy: -1 }).success).toBe(false)
  })

  it('caps ¥ fields at PG_INT_MAX and ₹ paise at PAISE_MAX', () => {
    expect(TargetsPut.safeParse({ ...full, savingsJpy: PG_INT_MAX + 1 }).success).toBe(false)
    expect(TargetsPut.safeParse({ ...full, savingsJpy: PG_INT_MAX }).success).toBe(true)
    expect(TargetsPut.safeParse({ ...full, prepaymentPaise: PAISE_MAX + 1 }).success).toBe(false)
    expect(TargetsPut.safeParse({ ...full, prepaymentPaise: PAISE_MAX }).success).toBe(true)
  })
})

describe('Targets', () => {
  it('parses with the cycle plus all four nullable fields', () => {
    expect(Targets.safeParse({ cycle: '2026-10', ...full }).success).toBe(true)
    expect(Targets.safeParse({ cycle: '2026-10', savingsJpy: null, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null }).success).toBe(true)
  })
})
