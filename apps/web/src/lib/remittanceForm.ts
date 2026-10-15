import type { Account, Loan, Remittance, RemittanceInput, RemittancePurpose, RemittanceService } from '@nri/contracts'
import { effectiveRate, rateVsPlan } from '@nri/core'
import { rupees } from './format'

export const PURPOSE_LABELS: Record<RemittancePurpose, string> = {
  family: 'Family',
  india_savings: 'India savings',
  sip: 'SIP',
  loan_emi: 'Loan EMI',
  loan_prepayment: 'Loan prepayment',
  other: 'Other',
}
export const SERVICE_LABELS: Record<RemittanceService, string> = { wise: 'Wise', bank: 'Bank', other: 'Other' }

const LOAN_PURPOSES = new Set<RemittancePurpose>(['loan_emi', 'loan_prepayment'])
/** Only Loan EMI / Loan prepayment transfers need a loan link (design decision). */
export const needsLoan = (p: RemittancePurpose): boolean => LOAN_PURPOSES.has(p)

/** Active Japan accounts, for the "From" field. */
export const jpAccounts = (all: Account[]): Account[] => all.filter((a) => a.country === 'JP' && !a.archived)
/** Active India accounts, for the "To" field. */
export const inAccounts = (all: Account[]): Account[] => all.filter((a) => a.country === 'IN' && !a.archived)

export type LoanPickerState =
  | { kind: 'none' }
  | { kind: 'auto'; loan: Loan }
  | { kind: 'select'; loans: Loan[] }

/**
 * Design decision: no open loan → the loan-linked purposes are disabled ('none'); exactly one →
 * picked automatically, shown as text ('auto'); more than one → a real select ('select'). Loan
 * create/edit is out of scope (M3) — this only ever reads the already-open loans.
 */
export function loanPickerState(loans: Loan[]): LoanPickerState {
  const open = loans.filter((l) => l.closedAt === null)
  if (open.length === 0) return { kind: 'none' }
  if (open.length === 1) return { kind: 'auto', loan: open[0]! }
  return { kind: 'select', loans: open }
}

/** The loanId to send for a purpose/loan-picker combination, or null when the purpose needs none. */
export function loanIdFor(purpose: RemittancePurpose, state: LoanPickerState, selectedLoanId: string | null): string | null {
  if (!needsLoan(purpose)) return null
  if (state.kind === 'auto') return state.loan.id
  if (state.kind === 'select') return selectedLoanId
  return null
}

/** "¥1.6949 per ₹1" (4 decimals shown, per the design doc — the JSON rate itself always has 6). */
export function effectiveRateText(jpySent: number, inrPaise: number): string {
  return `¥${Number(effectiveRate(jpySent, inrPaise)).toFixed(4)} per ₹1`
}

/**
 * "vs planning rate" text + colour class — always paired with a word ("better"/"worse"/"at
 * plan"), never colour alone (spec §5/§7). `inrDiffPaise > 0` means the transfer did better than
 * the planning rate (core's own `rateVsPlan` doc comment).
 */
export function vsPlanText(jpySent: number, inrPaise: number, planningRate: string): { text: string; cls: 'good' | 'bad' | 'muted' } {
  const { diffPct, inrDiffPaise } = rateVsPlan(jpySent, inrPaise, planningRate)
  if (inrDiffPaise === 0) return { text: 'At plan', cls: 'muted' }
  const better = inrDiffPaise > 0
  const pct = Math.abs(diffPct).toFixed(2)
  const amount = rupees(Math.abs(inrDiffPaise))
  return { text: `${pct}% ${better ? 'better' : 'worse'} · ${amount} ${better ? 'more' : 'less'}`, cls: better ? 'good' : 'bad' }
}

/**
 * The fields to re-POST to restore a deleted transfer (design decision: no restore route — undo
 * re-POSTs the row's own values verbatim, nothing is re-converted).
 */
export function toRemittanceInput(r: Remittance): RemittanceInput {
  return {
    sentOn: r.sentOn, jpySent: r.jpySent, inrPaise: r.inrPaise, feeJpy: r.feeJpy, service: r.service,
    fromAccountId: r.fromAccountId, toAccountId: r.toAccountId, purpose: r.purpose, loanId: r.loanId, notes: r.notes,
  }
}
