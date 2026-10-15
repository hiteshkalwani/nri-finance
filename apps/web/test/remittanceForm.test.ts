import { describe, expect, it } from 'vitest'
import type { Loan, Remittance } from '@nri/contracts'
import { loanIdFor, loanPickerState, toRemittanceInput, vsPlanText } from '../src/lib/remittanceForm'

const loan = (id: string, closedAt: string | null = null): Loan => ({ id, name: `Loan ${id}`, closedAt })

describe('loanPickerState', () => {
  it('is "none" when there is no open loan', () => {
    expect(loanPickerState([loan('a', '2026-01-01')])).toEqual({ kind: 'none' })
    expect(loanPickerState([])).toEqual({ kind: 'none' })
  })
  it('auto-picks the single open loan', () => {
    const l = loan('a')
    expect(loanPickerState([l, loan('b', '2026-01-01')])).toEqual({ kind: 'auto', loan: l })
  })
  it('offers a select when more than one loan is open', () => {
    const state = loanPickerState([loan('a'), loan('b')])
    expect(state.kind).toBe('select')
    expect(state.kind === 'select' && state.loans.map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('loanIdFor', () => {
  it('is null for a purpose that does not need a loan', () => {
    expect(loanIdFor('family', { kind: 'auto', loan: loan('a') }, null)).toBeNull()
  })
  it('auto state always returns that loan, ignoring the selected id', () => {
    expect(loanIdFor('loan_emi', { kind: 'auto', loan: loan('a') }, 'b')).toBe('a')
  })
  it('select state returns whatever was selected', () => {
    expect(loanIdFor('loan_prepayment', { kind: 'select', loans: [loan('a'), loan('b')] }, 'b')).toBe('b')
  })
  it('none state is always null', () => {
    expect(loanIdFor('loan_emi', { kind: 'none' }, null)).toBeNull()
  })
})

describe('vsPlanText', () => {
  it('reads "At plan" with a neutral class when the effective rate matches the planning rate exactly', () => {
    // 100 yen / 100 paise (₹1.00) = rate 100 — matches a planning rate of 100.
    expect(vsPlanText(100, 100, '100')).toEqual({ text: 'At plan', cls: 'muted' })
  })
  it('reads "better" (good) when the transfer received more rupees than the plan would have', () => {
    // Sending ¥100 at a planning rate of 2 would buy ₹50 (5000 paise); receiving ₹60 (6000 paise) is better.
    const r = vsPlanText(100, 6000, '2')
    expect(r.cls).toBe('good')
    expect(r.text).toContain('better')
    expect(r.text).toContain('more')
  })
  it('reads "worse" (bad) when the transfer received fewer rupees than the plan would have', () => {
    const r = vsPlanText(100, 4000, '2')
    expect(r.cls).toBe('bad')
    expect(r.text).toContain('worse')
    expect(r.text).toContain('less')
  })
})

describe('toRemittanceInput', () => {
  it('strips id and rate, keeping every input field verbatim — for undo\'s re-POST', () => {
    const row: Remittance = {
      id: 'r1', sentOn: '2026-10-20', jpySent: 60000, inrPaise: 3540000, feeJpy: 600, service: 'wise',
      fromAccountId: 'acc-jp', toAccountId: 'acc-in', purpose: 'family', loanId: null, notes: 'rent',
      rate: '1.694915',
    }
    expect(toRemittanceInput(row)).toEqual({
      sentOn: '2026-10-20', jpySent: 60000, inrPaise: 3540000, feeJpy: 600, service: 'wise',
      fromAccountId: 'acc-jp', toAccountId: 'acc-in', purpose: 'family', loanId: null, notes: 'rent',
    })
  })
})
