import { sql } from 'drizzle-orm'
import {
  boolean, char, check, date, foreignKey, index, integer, numeric, pgEnum, pgTable, smallint, text, timestamp, unique,
  uuid,
} from 'drizzle-orm/pg-core'

export const country = pgEnum('country', ['JP', 'IN'])
export const currency = pgEnum('currency', ['JPY', 'INR'])
export const accountType = pgEnum('account_type', ['bank', 'cash', 'card', 'fd', 'investment'])
export const paymentMethod = pgEnum('payment_method', ['bank', 'cash', 'credit_card', 'ic_card'])
export const needWant = pgEnum('need_want', ['need', 'want'])
export const remittancePurpose = pgEnum('remittance_purpose', [
  'family', 'india_savings', 'sip', 'loan_emi', 'loan_prepayment', 'other',
])

const inr = (name: string) => numeric(name, { precision: 14, scale: 2 })
const rate = (name: string) => numeric(name, { precision: 12, scale: 6 })
const cycle = (name: string) => char(name, { length: 7 })
const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}
const owned = {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  ...stamps,
}
const cycleCheck = (col: string) => sql.raw(`${col} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`)

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  salaryJpy: integer('salary_jpy').notNull(),
  planningRateJpyPerInr: rate('planning_rate_jpy_per_inr').notNull(),
  cycleStartDay: smallint('cycle_start_day').notNull().default(25),
  timezone: text('timezone').notNull().default('Asia/Tokyo'),
  ...stamps,
}, (t) => [
  check('profiles_start_day', sql`${t.cycleStartDay} between 1 and 28`),
  check('profiles_rate_positive', sql`${t.planningRateJpyPerInr} > 0`),
])

export const accounts = pgTable('accounts', {
  ...owned,
  name: text('name').notNull(),
  country: country('country').notNull(),
  currency: currency('currency').notNull(),
  type: accountType('type').notNull(),
  isEmergencyFund: boolean('is_emergency_fund').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  legacyId: text('legacy_id'),
}, (t) => [
  unique('accounts_legacy').on(t.userId, t.legacyId),
  unique('accounts_user_id').on(t.userId, t.id),
  check('accounts_country_currency', sql`(${t.country} = 'JP') = (${t.currency} = 'JPY')`),
])

export const categories = pgTable('categories', {
  ...owned,
  name: text('name').notNull(),
  color: text('color').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  legacyId: text('legacy_id'),
}, (t) => [unique('categories_legacy').on(t.userId, t.legacyId), unique('categories_user_id').on(t.userId, t.id)])

export const loans = pgTable('loans', {
  ...owned,
  name: text('name').notNull(),
  principalInr: inr('principal_inr').notNull(),
  annualRatePct: numeric('annual_rate_pct', { precision: 6, scale: 3 }).notNull(),
  emiInr: inr('emi_inr').notNull(),
  tenureMonths: smallint('tenure_months').notNull(),
  startCycle: cycle('start_cycle').notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  legacyId: text('legacy_id'),
}, (t) => [
  unique('loans_legacy').on(t.userId, t.legacyId),
  unique('loans_user_id').on(t.userId, t.id),
  check('loans_start_cycle', cycleCheck('start_cycle')),
])

export const transactions = pgTable('transactions', {
  ...owned,
  occurredOn: date('occurred_on').notNull(),
  categoryId: uuid('category_id').notNull(),
  accountId: uuid('account_id'),
  description: text('description').notNull().default(''),
  amountJpy: integer('amount_jpy').notNull(),
  enteredCurrency: currency('entered_currency').notNull().default('JPY'),
  amountInr: inr('amount_inr'),
  rateUsed: rate('rate_used'),
  paymentMethod: paymentMethod('payment_method').notNull(),
  needWant: needWant('need_want').notNull(),
  notes: text('notes').notNull().default(''),
  legacyId: text('legacy_id'),
}, (t) => [
  unique('transactions_legacy').on(t.userId, t.legacyId),
  check('transactions_amount_positive', sql`${t.amountJpy} > 0`),
  index('transactions_user_date').on(t.userId, t.occurredOn.desc()),
  index('transactions_user_category').on(t.userId, t.categoryId),
  // Composite keys: a row can only point at a parent owned by the same user (RLS hides other users' rows but a plain FK only checks existence).
  foreignKey({ name: 'transactions_category_owner', columns: [t.userId, t.categoryId], foreignColumns: [categories.userId, categories.id] }),
  foreignKey({ name: 'transactions_account_owner', columns: [t.userId, t.accountId], foreignColumns: [accounts.userId, accounts.id] }),
])

export const remittances = pgTable('remittances', {
  ...owned,
  sentOn: date('sent_on').notNull(),
  jpySent: integer('jpy_sent').notNull(),
  inrReceived: inr('inr_received').notNull(),
  feeJpy: integer('fee_jpy').notNull().default(0),
  service: text('service').notNull().default(''),
  fromAccountId: uuid('from_account_id'),
  toAccountId: uuid('to_account_id'),
  purpose: remittancePurpose('purpose').notNull(),
  loanId: uuid('loan_id'),
  notes: text('notes').notNull().default(''),
  legacyId: text('legacy_id'),
}, (t) => [
  unique('remittances_legacy').on(t.userId, t.legacyId),
  check('remittances_amounts', sql`${t.jpySent} > 0 and ${t.inrReceived} > 0 and ${t.feeJpy} >= 0`),
  check('remittances_loan_link', sql`(${t.purpose} in ('loan_emi','loan_prepayment')) = (${t.loanId} is not null)`),
  index('remittances_user_date').on(t.userId, t.sentOn.desc()),
  foreignKey({ name: 'remittances_from_account_owner', columns: [t.userId, t.fromAccountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ name: 'remittances_to_account_owner', columns: [t.userId, t.toAccountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ name: 'remittances_loan_owner', columns: [t.userId, t.loanId], foreignColumns: [loans.userId, loans.id] }),
])

export const balanceSnapshots = pgTable('balance_snapshots', {
  ...owned,
  accountId: uuid('account_id').notNull(),
  cycle: cycle('cycle').notNull(),
  balanceJpy: integer('balance_jpy'),
  balanceInr: inr('balance_inr'),
  recordedOn: date('recorded_on').notNull(),
}, (t) => [
  unique('balance_snapshots_account_cycle').on(t.accountId, t.cycle),
  check('balance_snapshots_one_amount', sql`(${t.balanceJpy} is null) <> (${t.balanceInr} is null)`),
  check('balance_snapshots_cycle', cycleCheck('cycle')),
  foreignKey({ name: 'balance_snapshots_account_owner', columns: [t.userId, t.accountId], foreignColumns: [accounts.userId, accounts.id] }),
])

export const categoryBudgets = pgTable('category_budgets', {
  ...owned,
  categoryId: uuid('category_id').notNull(),
  amountJpy: integer('amount_jpy').notNull(),
  effectiveFromCycle: cycle('effective_from_cycle').notNull(),
}, (t) => [
  unique('category_budgets_from').on(t.categoryId, t.effectiveFromCycle),
  check('category_budgets_amount', sql`${t.amountJpy} >= 0`),
  check('category_budgets_cycle', cycleCheck('effective_from_cycle')),
  foreignKey({ name: 'category_budgets_category_owner', columns: [t.userId, t.categoryId], foreignColumns: [categories.userId, categories.id] }),
])

export const cycleTargets = pgTable('cycle_targets', {
  ...owned,
  cycle: cycle('cycle').notNull(),
  savingsTargetJpy: integer('savings_target_jpy'),
  emergencyFundTargetJpy: integer('emergency_fund_target_jpy'),
  remittanceTargetJpy: integer('remittance_target_jpy'),
  prepaymentTargetInr: inr('prepayment_target_inr'),
}, (t) => [unique('cycle_targets_cycle').on(t.userId, t.cycle), check('cycle_targets_cycle_format', cycleCheck('cycle'))])

export const loanPlannedPrepayments = pgTable('loan_planned_prepayments', {
  ...owned,
  loanId: uuid('loan_id').notNull(),
  monthIndex: smallint('month_index').notNull(),
  amountInr: inr('amount_inr').notNull(),
}, (t) => [
  unique('loan_planned_prepayments_month').on(t.loanId, t.monthIndex),
  check('loan_planned_prepayments_values', sql`${t.monthIndex} >= 1 and ${t.amountInr} > 0`),
  foreignKey({ name: 'loan_planned_prepayments_loan_owner', columns: [t.userId, t.loanId], foreignColumns: [loans.userId, loans.id] }).onDelete('cascade'),
])

export const sipPlans = pgTable('sip_plans', {
  ...owned,
  startingMonthlyInr: inr('starting_monthly_inr').notNull(),
  stepUpPct: numeric('step_up_pct', { precision: 5, scale: 2 }).notNull(),
  expectedReturnPct: numeric('expected_return_pct', { precision: 5, scale: 2 }).notNull(),
  startYear: smallint('start_year').notNull(),
  endYear: smallint('end_year').notNull(),
  redirectEmiAfterPayoff: boolean('redirect_emi_after_payoff').notNull().default(true),
}, (t) => [unique('sip_plans_user').on(t.userId), unique('sip_plans_user_id').on(t.userId, t.id)])

export const sipAllocations = pgTable('sip_allocations', {
  ...owned,
  planId: uuid('plan_id').notNull(),
  fundName: text('fund_name').notNull(),
  pct: numeric('pct', { precision: 5, scale: 2 }).notNull(),
}, (t) => [
  check('sip_allocations_pct', sql`${t.pct} > 0 and ${t.pct} <= 100`),
  foreignKey({ name: 'sip_allocations_plan_owner', columns: [t.userId, t.planId], foreignColumns: [sipPlans.userId, sipPlans.id] }).onDelete('cascade'),
])

export const OWNED_TABLES = [
  'profiles', 'accounts', 'categories', 'loans', 'transactions', 'remittances', 'balance_snapshots',
  'category_budgets', 'cycle_targets', 'loan_planned_prepayments', 'sip_plans', 'sip_allocations',
] as const
