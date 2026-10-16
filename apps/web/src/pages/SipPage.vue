<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { SipPlan, SipProjection } from '@nri/contracts'
import { cycleOf, todayIn } from '@nri/core'
import PageHeader from '../components/PageHeader.vue'
import SipPlanDialog from '../components/SipPlanDialog.vue'
import SipProjectionChart from '../components/SipProjectionChart.vue'
import { apiFetch } from '../lib/api'
import { monthYearLabel, rupees } from '../lib/format'
import { useProfile } from '../lib/profile'
import { vsPlanWord } from '../lib/sipForm'

const me = useProfile()
const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)
const timezone = computed(() => me.data.value?.profile?.timezone ?? 'Asia/Tokyo')
const currentCycle = computed(() => cycleOf(todayIn(timezone.value), startDay.value))

const planQ = useQuery({ queryKey: ['sip'], queryFn: () => apiFetch('/api/sip', {}, SipPlan.nullable()) })
const plan = computed(() => planQ.data.value ?? null)
const projectionQ = useQuery({
  queryKey: ['sip', 'projection'],
  enabled: () => !!plan.value,
  queryFn: () => apiFetch('/api/sip/projection', {}, SipProjection),
})
const projection = computed(() => projectionQ.data.value ?? null)

const thisCycleActual = computed(() => projection.value?.actuals.find((a) => a.cycle === currentCycle.value) ?? null)
const vsPlan = computed(() => (thisCycleActual.value ? vsPlanWord(thisCycleActual.value.paidPaise, thisCycleActual.value.plannedPaise) : null))
const thisYear = computed(() => Number(currentCycle.value.slice(0, 4)))
const thisYearRow = computed(() => projection.value?.years.find((y) => y.year === thisYear.value) ?? null)
const lastYear = computed(() => projection.value?.years.at(-1) ?? null)
const projectedCorpusPaise = computed(() => (lastYear.value ? lastYear.value.sipCorpusPaise + lastYear.value.emiCorpusPaise : null))

const allocTotal = computed(() => (plan.value ? plan.value.allocations.reduce((s, a) => s + Number(a.pct), 0) : 0))
const allocAmount = (pct: string) => (thisYearRow.value ? Math.round((thisYearRow.value.monthlyPaise * Number(pct)) / 100) : 0)

const editOpen = ref(false)
</script>

<template>
  <template v-if="plan && projection">
    <PageHeader title="SIP">
      <v-btn color="primary" @click="editOpen = true">Edit plan</v-btn>
    </PageHeader>

    <div class="kpis">
      <v-card class="kpi">
        <div class="l">Paid this cycle</div>
        <div class="v num">{{ thisCycleActual ? rupees(thisCycleActual.paidPaise) : '—' }}</div>
        <div v-if="thisCycleActual" class="s">
          plan {{ rupees(thisCycleActual.plannedPaise) }} ·
          <span :class="vsPlan!.cls === 'good' ? 'text-success' : vsPlan!.cls === 'bad' ? 'text-error' : ''">{{ vsPlan!.text }}</span>
        </div>
        <div v-if="vsPlan" class="bar-mini"><i :style="{ width: `${vsPlan.pct}%`, background: 'rgb(var(--v-theme-primary-accent))' }" /></div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Monthly plan {{ thisYear }}</div>
        <div class="v num">{{ thisYearRow ? rupees(thisYearRow.monthlyPaise) : '—' }}</div>
        <div class="s">+{{ plan.stepUpPct }}% step-up each year</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Expected return</div>
        <div class="v num">{{ plan.expectedReturnPct }}% p.a.</div>
        <div class="s">redirect EMI after payoff: {{ plan.redirectEmiAfterPayoff ? 'on' : 'off' }}</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Projected corpus {{ plan.endYear }}</div>
        <div class="v num">{{ projectedCorpusPaise !== null ? rupees(projectedCorpusPaise) : '—' }}</div>
        <div v-if="projection.redirectFromCycle" class="s">incl. EMI redirected from {{ monthYearLabel(projection.redirectFromCycle) }}</div>
      </v-card>
    </div>

    <div class="grid2">
      <v-card>
        <div class="hd">
          <div><div class="eyebrow">Projection to {{ plan.endYear }}</div><div class="range" style="font-size: 15px">Year-end corpus</div></div>
          <div class="legend2"><span><i class="sip-dot" />SIP</span><span><i class="redir-dot" />EMI redirected</span></div>
        </div>
        <SipProjectionChart :years="projection.years" />
        <div class="tx-hd"><h2>Actual vs plan, last 12 cycles</h2></div>
        <div class="actuals">
          <div v-for="a in projection.actuals" :key="a.cycle" class="arow">
            <span>{{ monthYearLabel(a.cycle) }}</span>
            <div class="bar-mini"><i :style="{ width: `${a.plannedPaise > 0 ? Math.min(100, Math.round((a.paidPaise / a.plannedPaise) * 100)) : 0}%`, background: 'rgb(var(--v-theme-primary-accent))' }" /></div>
            <span class="num">{{ rupees(a.paidPaise) }} <span class="muted">/ {{ rupees(a.plannedPaise) }}</span></span>
          </div>
        </div>
      </v-card>
      <v-card>
        <div class="tx-hd"><h2>Allocation</h2><span class="chip">Total {{ allocTotal }}%</span></div>
        <div class="alloc">
          <div class="stack"><i v-for="a in plan.allocations" :key="a.fundName" :style="{ width: `${a.pct}%` }" /></div>
          <div v-for="a in plan.allocations" :key="a.fundName" class="kv2">
            <span class="dot" />{{ a.fundName }}<b class="ml-auto">{{ a.pct }}%</b><span class="muted amt">{{ rupees(allocAmount(a.pct)) }}</span>
          </div>
        </div>
      </v-card>
    </div>
  </template>

  <template v-else-if="planQ.isFetched.value && !plan">
    <PageHeader title="SIP">
      <v-btn color="primary" @click="editOpen = true">Set up plan</v-btn>
    </PageHeader>
    <v-card>
      <p class="pa-5 mb-0 text-medium-emphasis">No SIP plan yet. Set one up to track what you've paid against it and project your corpus.</p>
    </v-card>
  </template>
  <v-progress-linear v-else indeterminate />

  <SipPlanDialog v-model="editOpen" :plan="plan" />
</template>

<style scoped>
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
.bar-mini {
  height: 6px;
  border-radius: 99px;
  background: rgb(var(--v-theme-surface-variant));
  margin-top: 10px;
  overflow: hidden;
}
.bar-mini i {
  display: block;
  height: 100%;
  border-radius: 99px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
}
@media (max-width: 1100px) {
  .grid2 {
    grid-template-columns: minmax(0, 1fr);
  }
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
.sip-dot,
.redir-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  display: inline-block;
}
.sip-dot {
  background: rgb(var(--v-theme-primary-accent));
}
.redir-dot {
  background: rgb(var(--v-theme-success-accent));
}
.tx-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.tx-hd h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
}
.chip {
  margin-left: auto;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: 12.5px;
  font-weight: 600;
}
.actuals {
  padding: 0 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.arow {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}
.arow .bar-mini {
  margin: 0;
}
.alloc {
  padding: 0 22px 18px;
}
.stack {
  display: flex;
  height: 14px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
  margin: 4px 0 14px;
  background: rgb(var(--v-theme-surface-variant));
}
.stack i {
  display: block;
  height: 100%;
  background: rgb(var(--v-theme-primary-accent));
}
.kv2 {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid rgb(var(--v-border-color));
}
.kv2 .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary-accent));
}
.amt {
  width: 90px;
  text-align: right;
  font-size: 12.5px;
}
.muted {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
