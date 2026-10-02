import { and, eq, inArray } from 'drizzle-orm'
import { decimalFromPaise, inrPaiseFromJpy, jpyFromInrPaise, rateFromNumber } from '@nri/core'
import type { ImportResult, V1Document } from '@nri/contracts'
import {
  accounts, categories, cycleTargets, loanPlannedPrepayments, loans, profiles, remittances, sipAllocations, sipPlans,
  transactions, type Tx,
} from '@nri/db'

const PAYMENT: Record<string, 'bank' | 'cash' | 'credit_card' | 'ic_card'> = {
  bank: 'bank', cash: 'cash', 'credit card': 'credit_card', 'ic card': 'ic_card',
}
const paise = (n: number) => Math.round(n * 100) // only floating-point money conversion in the app (v1 boundary)
const inr = (n: number) => decimalFromPaise(paise(n))

export async function importV1(tx: Tx, userId: string, doc: V1Document): Promise<ImportResult> {
  const rate = rateFromNumber(doc.settings.jpyPerInr)
  const skippedRows: string[] = []
  const inserted = {
    categories: 0, accounts: 0, transactions: 0, remittances: 0, loans: 0, plannedPrepayments: 0, sipPlans: 0, cycleTargets: 0,
  }

  await tx.insert(profiles).values({
    userId,
    salaryJpy: Math.round(doc.settings.salaryJPY),
    planningRateJpyPerInr: rate,
    cycleStartDay: doc.settings.cycleStartDay,
    timezone: 'Asia/Tokyo',
  }).onConflictDoNothing()

  const starter = [
    { legacyId: 'starter-jp-bank', name: 'Japan bank', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false },
    { legacyId: 'starter-jp-emergency', name: 'Japan emergency fund', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: true },
    { legacyId: 'starter-in-bank', name: 'India bank', country: 'IN', currency: 'INR', type: 'bank', isEmergencyFund: false },
  ] as const
  inserted.accounts = (await tx.insert(accounts).values(starter.map((a) => ({ ...a, userId })))
    .onConflictDoNothing().returning({ id: accounts.id })).length
  const acc = Object.fromEntries(
    (await tx.select({ id: accounts.id, legacyId: accounts.legacyId }).from(accounts)
      .where(and(eq(accounts.userId, userId), inArray(accounts.legacyId, starter.map((a) => a.legacyId)))))
      .map((r) => [r.legacyId, r.id]),
  )

  const cats = doc.categories.filter((c) => c.id !== 'family-india')
  if (cats.length) {
    inserted.categories = (await tx.insert(categories)
      .values(cats.map((c, i) => ({ userId, name: c.name, color: c.color, sortOrder: i, legacyId: c.id })))
      .onConflictDoNothing().returning({ id: categories.id })).length
  }
  const catIds = Object.fromEntries(
    (await tx.select({ id: categories.id, legacyId: categories.legacyId }).from(categories)
      .where(eq(categories.userId, userId))).map((r) => [r.legacyId, r.id]),
  )

  const h = doc.settings.homeLoan
  inserted.loans = (await tx.insert(loans).values({
    userId, legacyId: 'v1-home-loan', name: 'Home loan', principalInr: inr(h.principalINR),
    annualRatePct: h.annualRatePct.toFixed(3), emiInr: inr(h.emiINR), tenureMonths: h.tenureMonths, startCycle: h.startCycle,
  }).onConflictDoNothing().returning({ id: loans.id })).length
  const [loan] = await tx.select({ id: loans.id }).from(loans)
    .where(and(eq(loans.userId, userId), eq(loans.legacyId, 'v1-home-loan')))
  const extras = doc.homeLoanExtras.filter((e) => e.extraPrepaymentINR > 0 && e.monthIndex >= 1)
  if (loan && extras.length) {
    inserted.plannedPrepayments = (await tx.insert(loanPlannedPrepayments)
      .values(extras.map((e) => ({ userId, loanId: loan.id, monthIndex: e.monthIndex, amountInr: inr(e.extraPrepaymentINR) })))
      .onConflictDoNothing().returning({ id: loanPlannedPrepayments.id })).length
  }

  const s = doc.settings.sip
  const newPlan = await tx.insert(sipPlans).values({
    userId, startingMonthlyInr: inr(s.startingMonthlyINR), stepUpPct: s.annualStepUpPct.toFixed(2),
    expectedReturnPct: s.estimatedReturnPct.toFixed(2), startYear: 2027, endYear: 2036,
  }).onConflictDoNothing().returning({ id: sipPlans.id })
  inserted.sipPlans = newPlan.length
  const allocations = Object.entries(s.allocation).filter(([, pct]) => pct > 0)
  if (newPlan[0] && allocations.length) {
    await tx.insert(sipAllocations).values(
      allocations.map(([fundName, pct]) => ({ userId, planId: newPlan[0]!.id, fundName, pct: pct.toFixed(2) })),
    )
  }

  if (doc.cycleTargets.length) {
    inserted.cycleTargets = (await tx.insert(cycleTargets).values(doc.cycleTargets.map((t) => ({
      userId, cycle: t.cycle,
      savingsTargetJpy: t.savingsTargetJPY ?? null,
      emergencyFundTargetJpy: t.emergencyFundTargetJPY ?? null,
      prepaymentTargetInr: t.loanPrepaymentTargetINR != null ? inr(t.loanPrepaymentTargetINR) : null,
    }))).onConflictDoNothing().returning({ id: cycleTargets.id })).length
  }

  const txnRows: (typeof transactions.$inferInsert)[] = []
  const remRows: (typeof remittances.$inferInsert)[] = []
  for (const t of doc.transactions) {
    const jpy = Math.round(t.amountJPY)
    const inrPaise = paise(t.amountINR)
    if (jpy <= 0 && inrPaise <= 0) { skippedRows.push(`${t.id}: no amount`); continue }
    if (t.categoryId === 'family-india') {
      const jpySent = jpy > 0 ? jpy : jpyFromInrPaise(inrPaise, rate)
      const received = inrPaise > 0 ? inrPaise : inrPaiseFromJpy(jpy, rate)
      remRows.push({
        userId, legacyId: t.id, sentOn: t.date, jpySent, inrReceived: decimalFromPaise(received), purpose: 'family',
        fromAccountId: acc['starter-jp-bank'], toAccountId: acc['starter-in-bank'],
        notes: [t.description, t.notes].filter(Boolean).join(' — '),
      })
      continue
    }
    const categoryId = catIds[t.categoryId]
    if (!categoryId) { skippedRows.push(`${t.id}: unknown category ${t.categoryId}`); continue }
    const enteredInINR = jpy <= 0
    txnRows.push({
      userId, legacyId: t.id, occurredOn: t.date, categoryId, description: t.description,
      amountJpy: enteredInINR ? jpyFromInrPaise(inrPaise, rate) : jpy,
      enteredCurrency: enteredInINR ? 'INR' : 'JPY',
      amountInr: enteredInINR ? decimalFromPaise(inrPaise) : null,
      rateUsed: enteredInINR ? rate : null,
      paymentMethod: PAYMENT[t.paymentMethod.toLowerCase()] ?? 'cash',
      needWant: t.needWant.toLowerCase() === 'want' ? 'want' : 'need',
      notes: t.notes,
    })
  }
  if (txnRows.length) {
    inserted.transactions = (await tx.insert(transactions).values(txnRows)
      .onConflictDoNothing().returning({ id: transactions.id })).length
  }
  if (remRows.length) {
    inserted.remittances = (await tx.insert(remittances).values(remRows)
      .onConflictDoNothing().returning({ id: remittances.id })).length
  }

  return { inserted, skippedRows }
}
