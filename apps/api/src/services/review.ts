import { and, between, eq } from 'drizzle-orm'
import type { Review } from '@nri/contracts'
import {
  type Cycle, cycleBounds, emergencyFundAt, nextCycle, paiseFromDecimal, previousCycle, reviewHighlights, summarizeCycle,
  targetVsActual,
} from '@nri/core'
import { balanceSnapshots, cycleIncomes, remittances, transactions, type Tx } from '@nri/db'
import { budgetAlerts } from './budgets'
import { loadNetWorthInputs } from './snapshots'
import { getTargets, targetsExist } from './targets'

/** TGT-2: this cycle's emergency-fund balance minus the previous cycle's — the contribution, not the running total. */
export async function emergencyFundChange(tx: Tx, userId: string, cycle: Cycle, startDay: number, timezone: string, rate: string): Promise<number> {
  const { accounts, snaps } = await loadNetWorthInputs(tx, userId, startDay, timezone)
  return emergencyFundAt(accounts, snaps, cycle, rate) - emergencyFundAt(accounts, snaps, previousCycle(cycle), rate)
}

/** REV-1: closed-cycle summary, targets vs actuals, budget alerts and highlights for the 25th review screen. */
export async function getReview(
  tx: Tx, userId: string, cycle: Cycle, startDay: number, timezone: string, salaryJpy: number, rate: string,
): Promise<Review> {
  const { start, end } = cycleBounds(cycle, startDay)
  const spend = await tx
    .select({ occurredOn: transactions.occurredOn, amountJpy: transactions.amountJpy, categoryId: transactions.categoryId, needWant: transactions.needWant })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), between(transactions.occurredOn, start, end)))
  const sentRows = await tx
    .select({ sentOn: remittances.sentOn, jpySent: remittances.jpySent, feeJpy: remittances.feeJpy, inrReceived: remittances.inrReceived, purpose: remittances.purpose })
    .from(remittances)
    .where(and(eq(remittances.userId, userId), between(remittances.sentOn, start, end)))
  const sent = sentRows.map((r) => ({ ...r, inrPaise: paiseFromDecimal(r.inrReceived) }))
  const [incomeRow] = await tx.select({ incomeJpy: cycleIncomes.incomeJpy }).from(cycleIncomes)
    .where(and(eq(cycleIncomes.userId, userId), eq(cycleIncomes.cycle, cycle)))
  const incomeJpy = incomeRow?.incomeJpy ?? salaryJpy
  const summary = summarizeCycle({ transactions: spend, remittances: sent, incomeJpy, cycle, startDay })
  const prepaymentPaise = sent.filter((r) => r.purpose === 'loan_prepayment').reduce((a, r) => a + r.inrPaise, 0)

  const next = nextCycle(cycle)
  const [efChangeJpy, targetsRow, alerts, balancesDoneRows, nextTargetsSet] = await Promise.all([
    emergencyFundChange(tx, userId, cycle, startDay, timezone, rate),
    getTargets(tx, userId, cycle),
    budgetAlerts(tx, userId, cycle, startDay),
    tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots)
      .where(and(eq(balanceSnapshots.userId, userId), eq(balanceSnapshots.cycle, cycle))).limit(1),
    targetsExist(tx, userId, next),
  ])

  const targets = targetVsActual(targetsRow, { keptJpy: summary.keptJpy, emergencyFundChangeJpy: efChangeJpy, sentJpy: summary.sentJpy, prepaymentPaise })
  const highlights = reviewHighlights(
    // shortcut: a zero-budget category that's over shows as 0% (core needs a number, not null); fine until that combination matters.
    alerts.filter((r) => r.state === 'over').map((r) => ({ categoryName: r.name, overByJpy: -r.remainingJpy, pct: r.pct ?? 0 })),
    targets,
  )

  return {
    cycle, start, end,
    summary: {
      incomeJpy: summary.incomeJpy, spentJpy: summary.spentJpy, sentJpy: summary.sentJpy,
      keptJpy: summary.keptJpy, savingsRatePct: summary.savingsRatePct, receivedPaise: summary.receivedPaise,
    },
    targets,
    budgets: alerts,
    highlights,
    balancesDone: balancesDoneRows.length > 0,
    nextCycle: next,
    nextTargetsSet,
  }
}
