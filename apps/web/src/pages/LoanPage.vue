<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loan, LoanSchedule } from '@nri/contracts'
import { amortize, cycleOf, todayIn } from '@nri/core'
import LoanBalanceChart from '../components/LoanBalanceChart.vue'
import LoanDialog from '../components/LoanDialog.vue'
import LoanPrepaymentDialog from '../components/LoanPrepaymentDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import { useQuery } from '@tanstack/vue-query'
import { z } from 'zod'
import { apiFetch } from '../lib/api'
import { inOtherCurrency } from '../lib/accounts'
import { monthYearLabel, rupees } from '../lib/format'
import { filterScheduleRows, payoffVsPlanText, plannedFromRows, type ScheduleFilter, yearlyRows } from '../lib/loanForm'
import { useProfile } from '../lib/profile'

const route = useRoute()
const router = useRouter()
const me = useProfile()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))

const loansQ = useQuery({ queryKey: ['loans'], queryFn: () => apiFetch('/api/loans', {}, z.array(Loan)) })
const openLoans = computed(() => (loansQ.data.value ?? []).filter((l) => l.closedAt === null))

// `/loans` (no id): redirect to the first open loan, or stay to show the empty state below.
watch([() => loansQ.data.value, id], ([loans, currentId]) => {
  if (currentId || !loans) return
  const first = loans.find((l) => l.closedAt === null)
  if (first) void router.replace(`/loans/${first.id}`)
}, { immediate: true })

const scheduleQ = useQuery({
  queryKey: ['loans', 'schedule', id],
  enabled: () => !!id.value,
  queryFn: () => apiFetch(`/api/loans/${id.value}/schedule`, {}, LoanSchedule),
})
const schedule = computed(() => scheduleQ.data.value ?? null)

const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)
const timezone = computed(() => me.data.value?.profile?.timezone ?? 'Asia/Tokyo')
const planningRate = computed(() => me.data.value?.profile?.planningRateJpyPerInr ?? null)
const currentCycle = computed(() => cycleOf(todayIn(timezone.value), startDay.value))

// The original-plan line/KPI: re-run `amortize` client-side with no actuals/planned, straight
// from the loan's own terms (already in `schedule.loan`) — avoids a second API endpoint just to
// carry a schedule the client can already compute for itself (same core function the API uses).
const planRows = computed(() => (schedule.value ? amortize(schedule.value.loan) : []))
const planYearly = computed(() => yearlyRows(planRows.value))
const projectedYearly = computed(() => (schedule.value ? yearlyRows(schedule.value.rows) : []))

const outstandingJpy = computed(() => {
  if (!schedule.value || !planningRate.value) return null
  return inOtherCurrency(schedule.value.outstandingPaise, 'INR', planningRate.value)
})
const payoffText = computed(() => (schedule.value ? payoffVsPlanText(schedule.value.projected.payoffCycle, schedule.value.plan.payoffCycle) : null))

const scheduleFilter = ref<ScheduleFilter>('upcoming')
const visibleRows = computed(() => (schedule.value ? filterScheduleRows(schedule.value.rows, scheduleFilter.value, currentCycle.value) : []))

const editOpen = ref(false)
const dialogMode = ref<'create' | 'edit'>('edit')
const dialogLoan = computed(() => (dialogMode.value === 'edit' && schedule.value ? schedule.value.loan : null))
const prepaymentOpen = ref(false)
const plannedPrepayments = computed(() => (schedule.value ? plannedFromRows(schedule.value.rows) : []))

function openAddLoan() {
  dialogMode.value = 'create'
  editOpen.value = true
}
function openEditLoan() {
  dialogMode.value = 'edit'
  editOpen.value = true
}
function onLoanSaved(saved: { id: string }) {
  if (dialogMode.value === 'create') void router.replace(`/loans/${saved.id}`)
}
</script>

<template>
  <template v-if="id && schedule">
    <PageHeader title="Home loan">
      <nav v-if="loansQ.data.value && loansQ.data.value.length" class="tabs" aria-label="Loans">
        <router-link v-for="l in loansQ.data.value" :key="l.id" :to="`/loans/${l.id}`" :class="{ on: l.id === id }">{{ l.name }}</router-link>
        <a href="#" @click.prevent="openAddLoan">+ Add loan</a>
      </nav>
      <v-btn variant="outlined" @click="prepaymentOpen = true">Plan a prepayment</v-btn>
      <v-btn color="primary" @click="openEditLoan">Edit loan</v-btn>
    </PageHeader>

    <div class="kpis">
      <v-card class="kpi">
        <div class="l">Outstanding</div>
        <div class="v num">{{ rupees(schedule.outstandingPaise) }}</div>
        <div class="s">
          <span v-if="outstandingJpy !== null">≈ {{ new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(outstandingJpy) }} · </span>
          {{ Number(schedule.loan.annualRatePct).toFixed(3) }}% p.a.
        </div>
      </v-card>
      <v-card class="kpi">
        <div class="l">EMI</div>
        <div class="v num">{{ rupees(schedule.loan.emiPaise) }}</div>
        <div class="s">paid via Loan EMI transfers</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Payoff</div>
        <div class="v num">{{ schedule.projected.payoffCycle ? monthYearLabel(schedule.projected.payoffCycle) : '—' }}</div>
        <div v-if="payoffText" class="s"><span :class="payoffText.cls === 'good' ? 'text-success' : payoffText.cls === 'bad' ? 'text-error' : ''">{{ payoffText.text }}</span></div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Interest saved</div>
        <div class="v num">{{ rupees(schedule.interestSavedPaise) }}</div>
        <div class="s">by prepayments so far</div>
      </v-card>
    </div>

    <v-card>
      <div class="hd">
        <div><div class="eyebrow">Balance · plan vs actual</div><div class="range" style="font-size: 15px">{{ monthYearLabel(schedule.loan.startCycle) }} – {{ schedule.projected.payoffCycle ? monthYearLabel(schedule.projected.payoffCycle) : monthYearLabel(schedule.plan.payoffCycle ?? schedule.loan.startCycle) }}</div></div>
        <div class="legend2"><span><i class="plan-dot" />Original plan</span><span><i class="actual-dot" />Actual + plan</span></div>
      </div>
      <LoanBalanceChart :plan-rows="planYearly" :projected-rows="projectedYearly" />
    </v-card>

    <v-card class="mt-4">
      <div class="tx-hd">
        <h2>Schedule</h2>
        <div class="right">
          <div class="seg" role="group" aria-label="Schedule filter">
            <v-btn v-for="f in (['upcoming', 'past', 'all'] as const)" :key="f" :ripple="false" :class="{ on: scheduleFilter === f }" :aria-pressed="scheduleFilter === f" variant="text" @click="scheduleFilter = f">
              {{ f === 'upcoming' ? 'Upcoming' : f === 'past' ? 'Past' : 'All' }}
            </v-btn>
          </div>
        </div>
      </div>
      <p v-if="!visibleRows.length" class="pa-5 mb-0 text-medium-emphasis">Nothing to show for this filter.</p>
      <div v-else class="stable" role="table" aria-label="Loan schedule">
        <div class="sh" role="row"><span>Month</span><span>Cycle</span><span>Opening</span><span>Interest</span><span>EMI</span><span>Extra</span><span>Closing</span></div>
        <div v-for="r in visibleRows" :key="r.month" class="sr" role="row" :class="{ actual: r.actual }">
          <span>{{ r.month }}<span v-if="r.actual" class="tagp">actual</span></span>
          <span>{{ monthYearLabel(r.cycle) }}</span>
          <span>{{ rupees(r.openingPaise) }}</span>
          <span>{{ rupees(r.interestPaise) }}</span>
          <span>{{ rupees(r.emiPaise) }}</span>
          <span>{{ r.extraPaise ? rupees(r.extraPaise) : '—' }}</span>
          <span>{{ rupees(r.closingPaise) }}</span>
        </div>
      </div>
    </v-card>
  </template>

  <template v-else-if="(id && scheduleQ.error.value) || (loansQ.data.value && openLoans.length === 0)">
    <PageHeader title="Home loan">
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openAddLoan">Add loan</v-btn>
    </PageHeader>
    <v-card>
      <p class="pa-5 mb-0 text-medium-emphasis">No open loan yet. Add one to see its schedule and payoff here.</p>
    </v-card>
  </template>
  <v-progress-linear v-else indeterminate />

  <LoanDialog v-model="editOpen" :loan="dialogLoan" @saved="onLoanSaved" />
  <LoanPrepaymentDialog
    v-if="id && schedule" v-model="prepaymentOpen" :loan-id="id" :start-cycle="schedule.loan.startCycle" :planned="plannedPrepayments"
  />
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.tabs a {
  padding: 6px 12px;
  border-radius: 10px;
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
  font-size: 13.5px;
}
.tabs a.on {
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface));
}
.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
@media (max-width: 1100px) {
  .kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}
.kpi {
  padding: 16px 18px;
}
.kpi .l {
  font-size: 12.5px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
}
.kpi .v {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.3px;
  margin-top: 4px;
}
.kpi .s {
  font-size: 12.5px;
  color: rgb(var(--v-theme-on-surface-variant));
  margin-top: 2px;
}
.hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px 6px;
  flex-wrap: wrap;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
}
.range {
  font-size: 18px;
  font-weight: 700;
  margin-top: 2px;
}
.legend2 {
  display: flex;
  gap: 14px;
  margin-left: auto;
  font-size: 12.5px;
  color: rgb(var(--v-theme-on-surface-variant));
}
.legend2 span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend2 i,
.plan-dot,
.actual-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  display: inline-block;
}
.plan-dot {
  background: rgb(var(--v-theme-on-surface-variant));
}
.actual-dot {
  background: rgb(var(--v-theme-primary-accent));
}
.tx-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  flex-wrap: wrap;
}
.tx-hd h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
}
.tx-hd .right {
  margin-left: auto;
}
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 10px;
}
.seg .v-btn {
  min-width: 0;
}
.seg :deep(.v-btn.on.v-theme--light) {
  background: rgb(var(--v-theme-primary-darken-1));
  color: #fff;
}
.seg :deep(.v-btn.on.v-theme--dark) {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.stable {
  overflow-x: auto;
}
.sh,
.sr {
  display: grid;
  grid-template-columns: 90px 100px repeat(5, minmax(90px, 1fr));
  gap: 10px;
  padding: 10px 20px;
  align-items: center;
}
.sh {
  font-size: 12px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
}
.sr {
  border-top: 1px solid rgb(var(--v-border-color));
  font-size: 13.5px;
}
.sr.actual {
  background: rgb(var(--v-theme-surface-variant));
}
.tagp {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary-accent));
  color: rgb(var(--v-theme-on-primary));
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
}
/* Phone (xs): only month/cycle, closing, and the actual badge stay — same compact-table reasoning as RemitPage/ExpenseRow. */
@media (max-width: 600px) {
  .sh,
  .sr {
    grid-template-columns: 1fr 1fr;
  }
  .sh span:nth-child(n + 3),
  .sr span:nth-child(n + 3):not(:last-child) {
    display: none;
  }
}
</style>
