<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AccountList, Remittance, RemittanceList, RemittanceRates, type RemittancePurpose } from '@nri/contracts'
import { cycleOf, nextCycle, previousCycle, todayIn } from '@nri/core'
import PageHeader from '../components/PageHeader.vue'
import RateHistoryChart from '../components/RateHistoryChart.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { PALETTE } from '../lib/categories'
import { flash } from '../lib/flash'
import { cycleLabel, dateRangeLabel, rupees, yen } from '../lib/format'
import { groupByDate } from '../lib/groups'
import { PURPOSE_LABELS, SERVICE_LABELS, vsPlanText } from '../lib/remittanceForm'
import { useProfile } from '../lib/profile'
import { undo } from '../lib/undo'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const me = useProfile()
const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)
const current = computed(() => cycleOf(todayIn(me.data.value?.profile?.timezone ?? 'Asia/Tokyo'), startDay.value))
const planningRate = computed(() => me.data.value?.profile?.planningRateJpyPerInr ?? '1')

// Consumed immediately, same reasoning as AccountsPage.vue's own `savedMessage`: a later visit or
// a refresh must never resurface the save/delete flash from the record/edit page.
const savedMessage = ref(flash.message.value)
flash.message.value = null

const cycleParam = computed(() => (typeof route.query.cycle === 'string' && route.query.cycle ? route.query.cycle : current.value))
const purposeParam = computed(() => (typeof route.query.purpose === 'string' ? (route.query.purpose as RemittancePurpose) : null))

const listQ = useQuery({
  queryKey: ['remittances', cycleParam, purposeParam],
  queryFn: () => {
    const params = new URLSearchParams({ cycle: cycleParam.value })
    if (purposeParam.value) params.set('purpose', purposeParam.value)
    return apiFetch(`/api/remittances?${params.toString()}`, {}, RemittanceList)
  },
  placeholderData: keepPreviousData,
})
const ratesQ = useQuery({
  queryKey: ['remittances', 'rates'],
  queryFn: () => apiFetch('/api/remittances/rates?limit=12', {}, RemittanceRates),
})
const accountsQ = useQuery({
  queryKey: ['accounts', 'all'],
  queryFn: async () => (await apiFetch('/api/accounts?include=archived', {}, AccountList)).items,
})

const list = computed(() => listQ.data.value ?? null)
const totals = computed(() => list.value?.totals ?? { jpySent: 0, inrPaise: 0, feesJpy: 0, count: 0, avgRate: null, byPurpose: [] })
const items = computed(() => list.value?.items ?? [])
const groups = computed(() => groupByDate(items.value.map((r) => ({ ...r, occurredOn: r.sentOn, amountJpy: r.jpySent }))))
const accountName = (id: string | null) => (id ? (accountsQ.data.value?.find((a) => a.id === id)?.name ?? '—') : '—')
const toAccountCount = computed(() => new Set(items.value.map((r) => r.toAccountId).filter((v): v is string => v !== null)).size)
const feePct = computed(() => (totals.value.jpySent > 0 ? Math.round((totals.value.feesJpy / totals.value.jpySent) * 1000) / 10 : 0))
const avgVsPlan = computed(() => (totals.value.avgRate !== null ? vsPlanText(totals.value.jpySent, totals.value.inrPaise, planningRate.value) : null))
const PURPOSE_KEYS = Object.keys(PURPOSE_LABELS) as RemittancePurpose[]
const purposeColor = (p: string) => PALETTE[PURPOSE_KEYS.indexOf(p as RemittancePurpose) % PALETTE.length]!
const pctWidth = (jpySent: number) => (totals.value.jpySent > 0 ? `${(jpySent / totals.value.jpySent) * 100}%` : '0%')

/** Merges `patch` onto the current query, dropping any key patched to `undefined` entirely (so a default filter never litters the URL). */
function pushQuery(patch: Record<string, string | undefined>) {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(route.query)) if (typeof v === 'string') merged[k] = v
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete merged[k]
    else merged[k] = v
  }
  void router.replace({ path: '/remit', query: merged })
}
function go(c: string) {
  pushQuery({ cycle: c === current.value ? undefined : c })
}
function setPurpose(p: string) {
  pushQuery({ purpose: p === 'all' ? undefined : p })
}

const restoreError = ref('')
const restore = useMutation({
  mutationFn: () => apiFetch('/api/remittances', { method: 'POST', body: JSON.stringify(undo.pendingRemittance.value) }, Remittance),
  onSuccess: async () => {
    undo.pendingRemittance.value = null
    restoreError.value = ''
    await Promise.all(['remittances', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  },
  onError: (e) => { restoreError.value = e instanceof ApiRequestError ? e.message : 'Could not restore that transfer' },
})
onUnmounted(() => { undo.pendingRemittance.value = null })
</script>

<template>
  <PageHeader title="Remittances">
    <div class="cycle-pill">
      <v-btn icon="mdi-chevron-left" variant="text" size="small" aria-label="Previous cycle" @click="go(previousCycle(cycleParam))" />
      <span>{{ cycleLabel(cycleParam, startDay) }}</span>
      <v-btn icon="mdi-chevron-right" variant="text" size="small" aria-label="Next cycle" @click="go(nextCycle(cycleParam))" />
    </div>
    <v-btn to="/remit/new" color="primary" prepend-icon="mdi-plus">Record transfer</v-btn>
  </PageHeader>

  <template v-if="list">
    <div class="kpis">
      <v-card class="kpi">
        <div class="l">Sent this cycle</div>
        <div class="v num">{{ yen(totals.jpySent) }}</div>
        <div class="s">{{ totals.count }} transfer{{ totals.count === 1 ? '' : 's' }}</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Received in India</div>
        <div class="v num">{{ rupees(totals.inrPaise) }}</div>
        <div class="s">across {{ toAccountCount }} account{{ toAccountCount === 1 ? '' : 's' }}</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Average rate</div>
        <div class="v num">{{ totals.avgRate !== null ? `¥${Number(totals.avgRate).toFixed(4)}` : '—' }}</div>
        <div v-if="avgVsPlan" class="s">
          per ₹1 · planning ¥{{ Number(planningRate).toFixed(4) }} ·
          <span :class="avgVsPlan.cls === 'good' ? 'text-success' : avgVsPlan.cls === 'bad' ? 'text-error' : ''">{{ avgVsPlan.text }}</span>
        </div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Fees</div>
        <div class="v num">{{ yen(totals.feesJpy) }}</div>
        <div class="s">{{ feePct }}% of sent · not counted as spending</div>
      </v-card>
    </div>

    <v-chip-group
      :model-value="purposeParam ?? 'all'" mandatory role="radiogroup" aria-label="Purpose filter" class="chip-row mb-4"
      @update:model-value="setPurpose"
    >
      <v-chip value="all" variant="outlined" :ripple="false" role="radio" :aria-checked="!purposeParam" class="c2">All</v-chip>
      <v-chip
        v-for="(label, key) in PURPOSE_LABELS" :key="key" :value="key" variant="outlined" :ripple="false" role="radio"
        :aria-checked="purposeParam === key" class="c2"
      >{{ label }}</v-chip>
    </v-chip-group>

    <div class="grid2">
      <div class="col">
        <v-card>
          <div class="hd"><div><div class="eyebrow">Sent by purpose</div><div class="range" style="font-size: 15px">{{ list ? dateRangeLabel(list.start, list.end) : '' }}</div></div></div>
          <div class="pa-5 pt-0">
            <p v-if="totals.byPurpose.length === 0" class="mb-0 text-medium-emphasis">Nothing sent yet this cycle.</p>
            <template v-else>
              <div class="stack"><i v-for="p in totals.byPurpose" :key="p.purpose" :style="{ width: pctWidth(p.jpySent), background: purposeColor(p.purpose) }" /></div>
              <div v-for="p in totals.byPurpose" :key="p.purpose" class="prow">
                <span><span class="dot" :style="{ background: purposeColor(p.purpose) }" />{{ PURPOSE_LABELS[p.purpose] }}</span>
                <b class="num">{{ yen(p.jpySent) }}</b>
                <span class="r">{{ rupees(p.inrPaise) }}</span>
              </div>
            </template>
          </div>
        </v-card>

        <v-card class="mt-4">
          <div class="tx-hd"><h2>Transfers</h2></div>
          <p v-if="groups.length === 0" class="pa-5 mb-0 text-medium-emphasis">No transfers in this cycle yet.</p>
          <template v-else>
            <template v-for="g in groups" :key="g.date">
              <div class="day-row"><span>{{ g.label }}</span><span class="num">{{ yen(g.totalJpy) }}</span></div>
              <div role="list" :aria-label="`Transfers on ${g.label}`">
                <div v-for="r in g.rows" :key="r.id" role="listitem">
                  <router-link :to="`/remit/${r.id}`" class="rrow">
                    <div>
                      <b>{{ SERVICE_LABELS[r.service] }}</b>
                      <span class="sub">{{ accountName(r.fromAccountId) }} → {{ accountName(r.toAccountId) }}</span>
                    </div>
                    <span class="c"><span class="dot" :style="{ background: purposeColor(r.purpose) }" />{{ PURPOSE_LABELS[r.purpose] }}</span>
                    <b class="num">{{ yen(r.jpySent) }}</b>
                    <span class="r">{{ rupees(r.inrPaise) }}<br />fee {{ yen(r.feeJpy) }}</span>
                    <span class="r num">¥{{ Number(r.rate).toFixed(4) }}</span>
                  </router-link>
                </div>
              </div>
            </template>
          </template>
        </v-card>
      </div>

      <v-card class="col">
        <div class="hd"><div><div class="eyebrow">Rate history</div><div class="range" style="font-size: 15px">Your last 12 transfers</div></div></div>
        <template v-if="ratesQ.data.value && ratesQ.data.value.points.length">
          <RateHistoryChart :points="ratesQ.data.value.points" :planning-rate="ratesQ.data.value.planningRate" />
        </template>
        <p v-else class="pa-5 mb-0 text-medium-emphasis">Record a transfer to see your rate history.</p>
      </v-card>
    </div>
  </template>
  <v-progress-linear v-else indeterminate />

  <v-snackbar :model-value="!!savedMessage" timeout="6000" @update:model-value="(v) => { if (!v) savedMessage = null }">
    <v-icon size="16" class="mr-1" aria-hidden="true">mdi-check-circle</v-icon>
    {{ savedMessage }}
  </v-snackbar>
  <v-snackbar :model-value="!!undo.pendingRemittance.value" timeout="5000" @update:model-value="(v) => { if (!v) undo.pendingRemittance.value = null }">
    Deleted
    <template #actions><v-btn variant="text" :loading="restore.isPending.value" @click="restore.mutate()">Undo</v-btn></template>
  </v-snackbar>
  <v-snackbar :model-value="!!restoreError" color="error" @update:model-value="(v) => { if (!v) restoreError = '' }">
    {{ restoreError }}
  </v-snackbar>
</template>

<style scoped>
.cycle-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgb(var(--v-border-color));
  background: rgb(var(--v-theme-surface));
  border-radius: 10px;
  overflow: hidden;
}
.cycle-pill span {
  padding: 0 4px;
  font-weight: 600;
  min-width: 150px;
  text-align: center;
  font-size: 14px;
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

.chip-row :deep(.v-slide-group__container) {
  overflow: visible;
}
.chip-row :deep(.v-slide-group__content) {
  flex-wrap: wrap;
  gap: 6px;
}
.chip-row :deep(.v-chip) {
  margin: 0;
  border: 1px solid rgb(var(--v-border-color));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-weight: 500;
  font-size: 13px;
}
.chip-row :deep(.v-chip--selected) {
  background: rgb(var(--v-theme-on-surface));
  border-color: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 16px;
}
@media (max-width: 1100px) {
  .grid2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
.col {
  min-width: 0;
}

.tx-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
}
.tx-hd h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
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

.stack {
  display: flex;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
  margin-bottom: 12px;
  background: rgb(var(--v-theme-surface-variant));
}
.stack i {
  display: block;
  height: 100%;
}
.prow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
}
.prow span:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
}
.prow b {
  margin-left: auto;
}
.prow .r {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
  min-width: 70px;
  text-align: right;
}
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: none;
}

.day-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 20px;
  font-weight: 600;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
  border-top: 1px solid rgb(var(--v-border-color));
}
.rrow {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 100px 110px 90px;
  gap: 12px;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface));
}
.rrow:hover,
.rrow:focus-visible {
  background: rgb(var(--v-theme-surface-variant));
}
.rrow:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.rrow .sub {
  display: block;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
}
.rrow .c {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.rrow .r {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
  text-align: right;
}
</style>
