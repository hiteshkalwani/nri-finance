import { Hono } from 'hono'
import { and, between, eq } from 'drizzle-orm'
import { CycleString, Dashboard } from '@nri/contracts'
import {
  cycleBounds, cycleOf, lastCycles, paiseFromDecimal, spendByCategory, spendByCycle, summarizeCycle, targetVsActual, todayIn,
} from '@nri/core'
import { categories, cycleIncomes, remittances, transactions } from '@nri/db'
import { ApiError } from '../errors'
import type { AppVars } from '../middleware/db'
import { budgetAlerts } from '../services/budgets'
import { dashboardLoanSummary } from '../services/loans'
import { rateOut, requireProfile } from '../services/profile'
import { emergencyFundChange } from '../services/review'
import { dashboardSipSummary } from '../services/sip'
import { getTargets } from '../services/targets'

export const dashboardRoutes = new Hono<{ Variables: AppVars }>().get('/', async (c) => {
  const { db, userId } = c.var
  const profile = await requireProfile(db, userId)
  const startDay = profile.cycleStartDay
  const param = c.req.query('cycle')
  const parsed = param === undefined || param === '' ? null : CycleString.safeParse(param)
  if (parsed && !parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'cycle must be YYYY-MM', parsed.error.issues)
  const cycle = parsed?.data ?? cycleOf(todayIn(profile.timezone), startDay)

  const cycles = lastCycles(cycle, 12)
  const { start, end } = cycleBounds(cycle, startDay)
  const historyStart = cycleBounds(cycles[0]!, startDay).start
  const spend = await db
    .select({ occurredOn: transactions.occurredOn, amountJpy: transactions.amountJpy, categoryId: transactions.categoryId, needWant: transactions.needWant })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), between(transactions.occurredOn, historyStart, end)))
  const sentRows = await db
    .select({
      sentOn: remittances.sentOn, jpySent: remittances.jpySent, feeJpy: remittances.feeJpy,
      inrReceived: remittances.inrReceived, purpose: remittances.purpose,
    })
    .from(remittances)
    .where(and(eq(remittances.userId, userId), between(remittances.sentOn, start, end)))
  const sent = sentRows.map((r) => ({ ...r, inrPaise: paiseFromDecimal(r.inrReceived) }))
  const cats = new Map(
    (await db.select({ id: categories.id, name: categories.name, color: categories.color }).from(categories)
      .where(eq(categories.userId, userId))).map((r) => [r.id, r]),
  )
  const [incomeRow] = await db.select({ incomeJpy: cycleIncomes.incomeJpy }).from(cycleIncomes)
    .where(and(eq(cycleIncomes.userId, userId), eq(cycleIncomes.cycle, cycle)))
  const incomeJpy = incomeRow?.incomeJpy ?? profile.salaryJpy
  const summary = summarizeCycle({ transactions: spend, remittances: sent, incomeJpy, cycle, startDay })

  const sipPaidPaise = summary.sentByPurpose.find((p) => p.purpose === 'sip')?.inrPaise ?? 0
  const prepaymentPaise = sent.filter((r) => r.purpose === 'loan_prepayment').reduce((a, r) => a + r.inrPaise, 0)
  const [loan, sip, alerts, efChangeJpy, targetsRow] = await Promise.all([
    dashboardLoanSummary(db, userId, startDay, profile.timezone),
    dashboardSipSummary(db, userId, startDay, profile.timezone, sipPaidPaise),
    budgetAlerts(db, userId, cycle, startDay),
    emergencyFundChange(db, userId, cycle, startDay, profile.timezone, rateOut(profile.planningRateJpyPerInr)),
    getTargets(db, userId, cycle),
  ])
  const budgets = {
    overCount: alerts.filter((a) => a.state === 'over').length,
    nearCount: alerts.filter((a) => a.state === 'near').length,
    rows: alerts.slice(0, 5),
  }
  const targets = targetVsActual(targetsRow, {
    keptJpy: summary.keptJpy, emergencyFundChangeJpy: efChangeJpy, sentJpy: summary.sentJpy, prepaymentPaise,
  })

  return c.json(Dashboard.parse({
    cycle, start, end,
    salaryJpy: profile.salaryJpy,
    incomeOverridden: incomeRow !== undefined,
    ...summary,
    byCategory: spendByCategory(spend, cycle, startDay).map((s) => ({ ...s, name: cats.get(s.categoryId)!.name, color: cats.get(s.categoryId)!.color })),
    byCycle: spendByCycle(spend, cycles, startDay),
    loan, sip, budgets, targets,
  }))
})
