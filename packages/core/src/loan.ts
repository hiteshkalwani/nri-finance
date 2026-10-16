import { nextCycle, type Cycle } from './cycles'
import { divRound } from './money'

export type LoanTerms = { principalPaise: number; annualRatePct: string; emiPaise: number; startCycle: Cycle }
/** What was really paid in a cycle: loan EMI and prepayment remittances, summed by the caller. */
export type LoanActual = { cycle: Cycle; emiPaise: number; extraPaise: number }
export type PlannedExtra = { monthIndex: number; amountPaise: number }
export type ScheduleRow = {
  month: number
  cycle: Cycle
  openingPaise: number
  interestPaise: number
  emiPaise: number
  extraPaise: number
  closingPaise: number
  actual: boolean
}

// 100 years: an EMI that never covers the interest would otherwise loop forever.
const MAX_MONTHS = 1200

/**
 * LOAN-2/3. Month 1 is the start cycle. A month with an actual row uses it (EMI and extra both, plan ignored);
 * otherwise the plan: the EMI plus any planned extra. Payments are capped at what is owed, so closing never goes
 * below 0, and the schedule stops at payoff.
 */
export function amortize(loan: LoanTerms, actuals: LoanActual[] = [], planned: PlannedExtra[] = []): ScheduleRow[] {
  // numeric(6,3) → micro-percent; not parseRate, which refuses a 0% loan.
  const rateMicro = BigInt(Math.round(Number(loan.annualRatePct) * 1_000_000))
  const actualBy = new Map(actuals.map((a) => [a.cycle, a]))
  const plannedBy = new Map(planned.map((p) => [p.monthIndex, p.amountPaise]))
  const rows: ScheduleRow[] = []
  let opening = loan.principalPaise
  let cycle = loan.startCycle
  for (let month = 1; opening > 0 && month <= MAX_MONTHS; month++, cycle = nextCycle(cycle)) {
    const interest = Number(divRound(BigInt(opening) * rateMicro, 1200n * 1_000_000n))
    const due = opening + interest
    const a = actualBy.get(cycle)
    const emi = Math.min(a ? a.emiPaise : loan.emiPaise, due)
    const extra = Math.min(a ? a.extraPaise : (plannedBy.get(month) ?? 0), due - emi)
    const closing = due - emi - extra
    rows.push({ month, cycle, openingPaise: opening, interestPaise: interest, emiPaise: emi, extraPaise: extra, closingPaise: closing, actual: !!a })
    opening = closing
  }
  return rows
}

/** LOAN-4. payoffCycle is null when the schedule hit the month cap without reaching 0. */
export function loanTotals(rows: ScheduleRow[]): { payoffCycle: Cycle | null; months: number; totalInterestPaise: number } {
  const last = rows.at(-1)
  return {
    payoffCycle: last && last.closingPaise === 0 ? last.cycle : null,
    months: rows.length,
    totalInterestPaise: rows.reduce((s, r) => s + r.interestPaise, 0),
  }
}

/** LOAN-4: original plan (EMI only) vs actual-to-date + plan for the rest; interestSaved = plan − projected. */
export function loanOutcome(loan: LoanTerms, actuals: LoanActual[], planned: PlannedExtra[]) {
  const plan = loanTotals(amortize(loan))
  const schedule = amortize(loan, actuals, planned)
  const projected = loanTotals(schedule)
  return { schedule, plan, projected, interestSavedPaise: plan.totalInterestPaise - projected.totalInterestPaise }
}
