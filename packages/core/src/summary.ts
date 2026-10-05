import { cycleOf, type Cycle, type IsoDate } from './cycles'

export type SpendRow = { occurredOn: IsoDate; amountJpy: number; categoryId: string; needWant: 'need' | 'want' }
export type RemitRow = { sentOn: IsoDate; jpySent: number; feeJpy: number }
export type CycleSummary = {
  incomeJpy: number
  spentJpy: number
  sentJpy: number
  feesJpy: number
  keptJpy: number
  savingsRatePct: number | null
  expenseCount: number
  largestJpy: number
  needJpy: number
  wantJpy: number
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** DASH-2. Remittance fees are reported apart from money sent and are not spending (PRD open question 1). */
export function summarizeCycle(input: {
  transactions: SpendRow[]
  remittances: RemitRow[]
  salaryJpy: number
  cycle: Cycle
  startDay: number
}): CycleSummary {
  const { cycle, startDay, salaryJpy } = input
  const spent = input.transactions.filter((t) => cycleOf(t.occurredOn, startDay) === cycle)
  const sent = input.remittances.filter((r) => cycleOf(r.sentOn, startDay) === cycle)
  const spentJpy = sum(spent.map((t) => t.amountJpy))
  const sentJpy = sum(sent.map((r) => r.jpySent))
  const keptJpy = salaryJpy - spentJpy - sentJpy
  return {
    incomeJpy: salaryJpy,
    spentJpy,
    sentJpy,
    feesJpy: sum(sent.map((r) => r.feeJpy)),
    keptJpy,
    savingsRatePct: salaryJpy > 0 ? Math.round((keptJpy * 1000) / salaryJpy) / 10 : null,
    expenseCount: spent.length,
    largestJpy: spent.reduce((m, t) => Math.max(m, t.amountJpy), 0),
    needJpy: sum(spent.filter((t) => t.needWant === 'need').map((t) => t.amountJpy)),
    wantJpy: sum(spent.filter((t) => t.needWant === 'want').map((t) => t.amountJpy)),
  }
}

/** DASH-3 donut: spend per category in the cycle, largest first (ties by id, for a stable order). */
export function spendByCategory(transactions: SpendRow[], cycle: Cycle, startDay: number) {
  const totals = new Map<string, number>()
  for (const t of transactions) {
    if (cycleOf(t.occurredOn, startDay) === cycle) totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amountJpy)
  }
  return [...totals]
    .map(([categoryId, spentJpy]) => ({ categoryId, spentJpy }))
    .sort((x, y) => y.spentJpy - x.spentJpy || x.categoryId.localeCompare(y.categoryId))
}

/** DASH-3 bar: spend per cycle for the given cycles, zero-filled, in the given order. */
export function spendByCycle(transactions: SpendRow[], cycles: Cycle[], startDay: number) {
  const totals = new Map(cycles.map((c) => [c, 0]))
  for (const t of transactions) {
    const c = cycleOf(t.occurredOn, startDay)
    if (totals.has(c)) totals.set(c, totals.get(c)! + t.amountJpy)
  }
  return cycles.map((cycle) => ({ cycle, spentJpy: totals.get(cycle)! }))
}
