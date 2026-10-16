export type Targets = { savingsJpy: number | null; emergencyFundJpy: number | null; remittanceJpy: number | null; prepaymentPaise: number | null }
export type Actuals = { keptJpy: number; emergencyFundChangeJpy: number; sentJpy: number; prepaymentPaise: number }
export type TargetKey = 'savings' | 'emergencyFund' | 'remittance' | 'prepayment'
export type TargetRow = { key: TargetKey; targetValue: number; actualValue: number; diff: number; met: boolean }
export type Highlight = { tone: 'bad' | 'warn' | 'good'; text: string }

const TARGET_FIELDS: { key: TargetKey; target: keyof Targets; actual: keyof Actuals }[] = [
  { key: 'savings', target: 'savingsJpy', actual: 'keptJpy' },
  { key: 'emergencyFund', target: 'emergencyFundJpy', actual: 'emergencyFundChangeJpy' },
  { key: 'remittance', target: 'remittanceJpy', actual: 'sentJpy' },
  { key: 'prepayment', target: 'prepaymentPaise', actual: 'prepaymentPaise' },
]

/** TGT-2: one row per target that was set (nulls skipped); diff = actual − target, met when actual >= target. */
export function targetVsActual(targets: Targets, actuals: Actuals): TargetRow[] {
  const rows: TargetRow[] = []
  for (const f of TARGET_FIELDS) {
    const targetValue = targets[f.target]
    if (targetValue === null) continue
    const actualValue = actuals[f.actual]
    rows.push({ key: f.key, targetValue, actualValue, diff: actualValue - targetValue, met: actualValue >= targetValue })
  }
  return rows
}

const TARGET_LABELS: Record<TargetKey, string> = {
  savings: 'Savings',
  emergencyFund: 'Emergency fund contribution',
  remittance: 'Remittance',
  prepayment: 'Loan prepayment',
}

// No yen formatter exists elsewhere in packages/core; kept minimal and local to this file.
const yen = (n: number) => `￥${Math.round(Math.abs(n)).toLocaleString('en-US')}`

/**
 * REV-1: short list of what's worth a look — over-budget categories, then targets missed, then targets met;
 * bad -> warn -> good, capped at 5.
 */
export function reviewHighlights(overBudget: { categoryName: string; overByJpy: number; pct: number }[], targets: TargetRow[]): Highlight[] {
  const bad: Highlight[] = overBudget.map((c) => ({
    tone: 'bad',
    text: `${c.categoryName} went over budget by ${yen(c.overByJpy)} (${Math.round(c.pct)}%).`,
  }))
  const warn: Highlight[] = []
  const good: Highlight[] = []
  for (const t of targets) {
    const label = TARGET_LABELS[t.key]
    if (!t.met) {
      warn.push({ tone: 'warn', text: `${label} ${yen(t.diff)} short of target.` })
    } else if (t.key === 'savings') {
      good.push({ tone: 'good', text: `Kept ${yen(t.actualValue)} — ${yen(t.diff)} above the savings target.` })
    } else {
      good.push({ tone: 'good', text: `${label} on target.` })
    }
  }
  return [...bad, ...warn, ...good].slice(0, 5)
}
