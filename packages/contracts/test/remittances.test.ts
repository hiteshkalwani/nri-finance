import { describe, expect, it } from 'vitest'
import { CycleIncomeInput, RemittanceInput, RemittancePatch } from '../src'

const loanId = '11111111-1111-4111-8111-111111111111'
const base = { sentOn: '2026-10-05', jpySent: 50000, inrPaise: 29_500_00, service: 'wise', purpose: 'family' as const }

describe('RemittanceInput', () => {
  it('accepts a valid non-loan transfer, defaulting fee and notes', () => {
    const r = RemittanceInput.parse(base)
    expect(r.feeJpy).toBe(0)
    expect(r.notes).toBe('')
  })
  it('rejects an unknown purpose', () => {
    expect(RemittanceInput.safeParse({ ...base, purpose: 'rent' }).success).toBe(false)
  })
  it('rejects a fee greater than ¥ sent', () => {
    const r = RemittanceInput.safeParse({ ...base, feeJpy: 50001 })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues[0]!.path).toEqual(['feeJpy'])
  })
  it('accepts a fee equal to ¥ sent', () => {
    expect(RemittanceInput.safeParse({ ...base, feeJpy: 50000 }).success).toBe(true)
  })
  it('loan link: requires loanId for loan_emi/loan_prepayment, and rejects it otherwise', () => {
    const noLoan = RemittanceInput.safeParse({ ...base, purpose: 'loan_emi' })
    expect(noLoan.success).toBe(false)
    expect(!noLoan.success && noLoan.error.issues[0]!.path).toEqual(['loanId'])

    const withLoan = RemittanceInput.safeParse({ ...base, purpose: 'loan_prepayment', loanId })
    expect(withLoan.success).toBe(true)

    const strayLoan = RemittanceInput.safeParse({ ...base, purpose: 'family', loanId })
    expect(strayLoan.success).toBe(false)
    expect(!strayLoan.success && strayLoan.error.issues[0]!.path).toEqual(['loanId'])
  })
  it('rejects zero/negative/fractional amounts and unknown keys', () => {
    expect(RemittanceInput.safeParse({ ...base, jpySent: 0 }).success).toBe(false)
    expect(RemittanceInput.safeParse({ ...base, jpySent: -1 }).success).toBe(false)
    expect(RemittanceInput.safeParse({ ...base, inrPaise: 1.5 }).success).toBe(false)
    expect(RemittanceInput.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})

describe('RemittancePatch', () => {
  it('rejects an empty object', () => {
    expect(RemittancePatch.safeParse({}).success).toBe(false)
  })
  it('accepts any non-empty subset, without re-checking the loan or fee rules', () => {
    expect(RemittancePatch.safeParse({ notes: 'updated' }).success).toBe(true)
    expect(RemittancePatch.safeParse({ purpose: 'loan_emi' }).success).toBe(true) // no loanId given, but not refined here
    expect(RemittancePatch.safeParse({ feeJpy: 999999 }).success).toBe(true) // no jpySent given to compare against
  })
  it('rejects unknown keys', () => {
    expect(RemittancePatch.safeParse({ extra: 1 }).success).toBe(false)
  })
})

describe('CycleIncomeInput', () => {
  it('accepts a non-negative income or null to clear the override', () => {
    expect(CycleIncomeInput.safeParse({ incomeJpy: 300000 }).success).toBe(true)
    expect(CycleIncomeInput.safeParse({ incomeJpy: null }).success).toBe(true)
    expect(CycleIncomeInput.safeParse({ incomeJpy: -1 }).success).toBe(false)
    expect(CycleIncomeInput.safeParse({ incomeJpy: 1.5 }).success).toBe(false)
  })
})
