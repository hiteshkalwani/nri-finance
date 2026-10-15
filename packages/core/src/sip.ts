import type { Cycle } from './cycles'

export type SipPlan = {
  startingMonthlyPaise: number
  stepUpPct: number
  expectedReturnPct: number
  startYear: number
  endYear: number
  redirectEmiAfterPayoff: boolean
}
/** EMI moved into SIP from `fromCycle` (the cycle after the loan's real payoff). */
export type EmiRedirect = { fromCycle: Cycle; emiPaise: number }
export type SipYear = {
  year: number
  monthlyPaise: number
  sipPaidPaise: number
  emiPaidPaise: number
  sipCorpusPaise: number
  emiCorpusPaise: number
}

/** Planned monthly SIP for a year: starting amount stepped up once a year, compounded. */
export function sipMonthlyFor(plan: SipPlan, year: number): number {
  return Math.round(plan.startingMonthlyPaise * (1 + plan.stepUpPct / 100) ** Math.max(0, year - plan.startYear))
}

/**
 * SIP-4. Yearly rows startYear..endYear, months Jan–Dec. Each month's payment is invested at the start of the month
 * and grows at expectedReturn/12; the redirected EMI is tracked as its own corpus so the chart can stack the two.
 */
export function sipProjection(plan: SipPlan, redirect: EmiRedirect | null): SipYear[] {
  const r = plan.expectedReturnPct / 1200
  const rows: SipYear[] = []
  // shortcut: corpus kept as a float and rounded per year; it is a projection, not a ledger.
  let sip = 0
  let emi = 0
  for (let year = plan.startYear; year <= plan.endYear; year++) {
    const monthly = sipMonthlyFor(plan, year)
    let emiPaid = 0
    for (let m = 1; m <= 12; m++) {
      const cycle = `${year}-${String(m).padStart(2, '0')}`
      const emiNow = plan.redirectEmiAfterPayoff && redirect && cycle >= redirect.fromCycle ? redirect.emiPaise : 0
      sip = (sip + monthly) * (1 + r)
      emi = (emi + emiNow) * (1 + r)
      emiPaid += emiNow
    }
    rows.push({
      year, monthlyPaise: monthly, sipPaidPaise: monthly * 12, emiPaidPaise: emiPaid,
      sipCorpusPaise: Math.round(sip), emiCorpusPaise: Math.round(emi),
    })
  }
  return rows
}
