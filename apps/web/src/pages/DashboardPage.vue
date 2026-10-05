<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay, useTheme } from 'vuetify'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { Bar, Doughnut } from 'vue-chartjs'
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js'
import type { ChartComponentRef } from 'vue-chartjs'
import { Dashboard, TransactionPage } from '@nri/contracts'
import { nextCycle, previousCycle } from '@nri/core'
import ExpenseRow from '../components/ExpenseRow.vue'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { useCategories } from '../lib/categories'
import { barData, donutData } from '../lib/charts'
import { safeColor } from '../lib/color'
import { cycleLabel, dateRangeLabel, MONTHS, yen } from '../lib/format'
import { groupByDate } from '../lib/groups'
import { legendRows } from '../lib/legend'
import { useProfile } from '../lib/profile'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const route = useRoute()
const router = useRouter()
const { xs } = useDisplay()
const theme = useTheme()
const me = useProfile()
const cats = useCategories()

const cycle = computed(() => (typeof route.query.cycle === 'string' ? route.query.cycle : ''))
const dash = useQuery({
  queryKey: ['dashboard', cycle],
  queryFn: () => apiFetch(`/api/dashboard${cycle.value ? `?cycle=${cycle.value}` : ''}`, {}, Dashboard),
  placeholderData: keepPreviousData,
  retry: (n, e) => !(e instanceof ApiRequestError && e.status === 409) && n < 2,
})
const needsProfile = computed(() => dash.error.value instanceof ApiRequestError && dash.error.value.status === 409)
const d = computed(() => dash.data.value)
const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)
const go = (c: string) => router.replace({ query: { cycle: c } })
// Both the donut and the bar open the ledger filtered to what was clicked (spec §5.5); only the
// previous/next arrows change the dashboard's own cycle. "Everything else" (categoryId null/undefined)
// links to the cycle without a category filter (controller ruling).
const ledgerLink = (cycle: string, categoryId?: string | null) => ({ path: '/spend', query: categoryId ? { cycle, categoryId } : { cycle } })
const catOf = (id: string) => cats.data.value?.find((c) => c.id === id)
// Short "Sep · ¥18,876" label for the compact cycle-links row — matches the bar chart's own
// month-only x-axis tick, so the two stay visually consistent at the side column's 340px width.
const monthOf = (cycle: string) => MONTHS[Number(cycle.slice(5)) - 1]

const recentCycle = computed(() => d.value?.cycle ?? '')
const recent = useQuery({
  queryKey: ['transactions', 'recent', recentCycle],
  queryFn: () => apiFetch(`/api/transactions?cycle=${recentCycle.value}&pageSize=5`, {}, TransactionPage),
  enabled: () => !!d.value,
  placeholderData: keepPreviousData,
})
const recentGroups = computed(() => groupByDate(recent.data.value?.items ?? []))

// Summary card derived figures — guarded against a zero denominator rather than showing NaN/Infinity.
const avgExpenseJpy = computed(() => (d.value && d.value.expenseCount > 0 ? Math.round(d.value.spentJpy / d.value.expenseCount) : null))
const needPct = computed(() => (d.value && d.value.spentJpy > 0 ? Math.round((d.value.needJpy / d.value.spentJpy) * 100) : null))
const wantPct = computed(() => (d.value && d.value.spentJpy > 0 ? Math.round((d.value.wantJpy / d.value.spentJpy) * 100) : null))
const spentPct = computed(() => (d.value && d.value.incomeJpy > 0 ? Math.round((d.value.spentJpy / d.value.incomeJpy) * 1000) / 10 : null))

// Spending-by-category: legend rows (limit/"Everything else"-folded) drive both the legend list and
// the donut's slices, so a slice's index always matches its legend row for hover/focus highlighting.
const legend = computed(() => (d.value ? legendRows(d.value.byCategory) : []))
const donutRef = ref<ChartComponentRef<'doughnut'> | null>(null)
const hoveredLegend = ref<number | null>(null)
function highlightSlice(i: number) {
  hoveredLegend.value = i
  const chart = donutRef.value?.chart
  if (!chart) return
  chart.setActiveElements([{ datasetIndex: 0, index: i }])
  chart.update()
}
function clearSliceHighlight() {
  hoveredLegend.value = null
  const chart = donutRef.value?.chart
  if (!chart) return
  chart.setActiveElements([])
  chart.update()
}
// Charts read colours from the active theme (useTheme()) so dark mode gets its own accent/neutral
// shades; these are resolved hex values, not CSS variable references, since a canvas fillStyle isn't
// guaranteed to resolve var() the way a DOM element's style would. Vuetify's `Color` type also allows
// non-string forms (number/HSV/RGB), which our own theme.ts never uses, so narrow to the plain hex string.
const themeHex = (key: string): string => {
  const c = theme.current.value.colors[key]
  return typeof c === 'string' ? c : '#000000'
}
const donutChartData = computed(() => donutData(legend.value, themeHex('on-surface-variant')))
const donutOptions = computed(() => ({
  cutout: '70%',
  plugins: { legend: { display: false } },
  elements: { arc: { hoverOffset: 10 } },
  onClick: (_e: unknown, els: { index: number }[]) => {
    const row = legend.value[els[0]?.index ?? -1]
    if (row && d.value) void router.push(ledgerLink(d.value.cycle, row.categoryId))
  },
}))

const barChartData = computed(() => (d.value ? barData(d.value, themeHex('primary')) : { labels: [], datasets: [] }))
const barOptions = {
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { y: { ticks: { callback: (v: string | number) => yen(Number(v)) } } },
  onClick: (_e: unknown, els: { index: number }[]) => {
    const c = d.value?.byCycle[els[0]?.index ?? -1]
    if (c) void router.push(ledgerLink(c.cycle))
  },
}
</script>

<template>
  <v-alert v-if="needsProfile" type="info" variant="tonal">
    Set up your profile first in <router-link to="/settings">Settings</router-link>, or import your v1 data there.
  </v-alert>
  <v-alert v-else-if="dash.error.value" type="error" variant="tonal">{{ dash.error.value.message }}</v-alert>
  <template v-else-if="d">
    <PageHeader title="Dashboard">
      <div class="cycle-pill">
        <v-btn icon="mdi-chevron-left" variant="text" size="small" aria-label="Previous cycle" @click="go(previousCycle(d.cycle))" />
        <span data-testid="cycle-label">{{ cycleLabel(d.cycle, startDay) }}</span>
        <v-btn icon="mdi-chevron-right" variant="text" size="small" aria-label="Next cycle" @click="go(nextCycle(d.cycle))" />
      </div>
      <!-- The bottom-nav's raised "+" already covers Add expense on phones. -->
      <v-btn v-if="!xs" to="/spend/new" color="primary" prepend-icon="mdi-plus">Add expense</v-btn>
    </PageHeader>

    <div class="kpis">
      <v-card class="kpi">
        <div class="l">Income</div>
        <div class="v num" data-testid="income">{{ yen(d.incomeJpy) }}</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Spent</div>
        <div class="v num" data-testid="spent">{{ yen(d.spentJpy) }}</div>
        <div v-if="spentPct !== null" class="s">{{ spentPct }}% of income</div>
        <div v-if="spentPct !== null" class="bar-mini"><i :style="{ width: `${Math.min(spentPct, 100)}%`, background: 'rgb(var(--v-theme-primary))' }" /></div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Sent home</div>
        <div class="v num" data-testid="sent">{{ yen(d.sentJpy) }}</div>
        <div v-if="d.feesJpy" class="s">fees {{ yen(d.feesJpy) }}</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Kept</div>
        <!-- A negative balance is never shown by colour alone: the formatted amount keeps its minus
             sign too, and the savings-rate sub-line always carries an explicit +/- sign. -->
        <div class="v num" :class="{ 'text-error': d.keptJpy < 0 }" data-testid="kept">{{ yen(d.keptJpy) }}</div>
        <div v-if="d.savingsRatePct !== null" class="s">
          <span :class="d.savingsRatePct >= 0 ? 'text-success' : 'text-error'" class="font-weight-medium">{{ d.savingsRatePct >= 0 ? '+' : '' }}{{ d.savingsRatePct }}%</span>
          savings rate
        </div>
        <div v-if="d.savingsRatePct !== null" class="bar-mini">
          <i :style="{ width: `${Math.min(Math.abs(d.savingsRatePct), 100)}%`, background: d.savingsRatePct >= 0 ? 'rgb(var(--v-theme-success))' : 'rgb(var(--v-theme-error))' }" />
        </div>
      </v-card>
    </div>

    <v-card>
      <div class="hd">
        <div>
          <div class="eyebrow">Spending by category</div>
          <div class="range">{{ dateRangeLabel(d.start, d.end) }}</div>
        </div>
      </div>
      <div class="spend-body">
        <template v-if="d.byCategory.length">
          <div class="donut-wrap">
            <Doughnut ref="donutRef" :data="donutChartData" :options="donutOptions" aria-hidden="true" role="presentation" />
            <div class="ctr"><b class="num">{{ yen(d.spentJpy) }}</b><span>Spent</span></div>
          </div>
          <!-- Text/keyboard equivalent of the donut, and the only way to reach a filtered ledger view
               by keyboard (DASH accessibility note): every slice's figures as a list of real links.
               Hovering/focusing one highlights its slice via Chart.js's setActiveElements. -->
          <div class="legend" aria-label="Category totals, each a link to the filtered ledger">
            <router-link
              v-for="(row, i) in legend"
              :key="row.categoryId ?? 'other'"
              :to="ledgerLink(d.cycle, row.categoryId)"
              class="lg"
              :class="{ hl: hoveredLegend === i }"
              @mouseenter="highlightSlice(i)"
              @mouseleave="clearSliceHighlight()"
              @focus="highlightSlice(i)"
              @blur="clearSliceHighlight()"
            >
              <span class="dot" :style="{ background: safeColor(row.color) }" />
              <span>
                <span class="n">{{ row.name }}</span><br />
                <span class="a num">{{ yen(row.spentJpy) }} <span>({{ row.pct.toFixed(1) }}%)</span></span>
              </span>
            </router-link>
          </div>
        </template>
        <p v-else class="pa-5 mb-0 text-medium-emphasis">No spending recorded in this cycle.</p>
      </div>
    </v-card>

    <div class="grid2">
      <v-card>
        <div class="tx-hd">
          <h2>Recent expenses</h2>
          <div class="right"><v-btn :to="{ path: '/spend', query: { cycle: d.cycle } }" variant="outlined" size="small">View all</v-btn></div>
        </div>
        <v-progress-linear v-if="recent.isLoading.value" indeterminate />
        <template v-if="recentGroups.length">
          <template v-for="g in recentGroups" :key="g.date">
            <div class="day-row"><span>{{ g.label }}</span><span class="num">{{ yen(g.totalJpy) }}</span></div>
            <ExpenseRow v-for="t in g.rows" :key="t.id" :t="t" :category="catOf(t.categoryId)" />
          </template>
        </template>
        <p v-else class="pa-5 mb-0 text-medium-emphasis">No expenses recorded in this cycle yet.</p>
      </v-card>
      <div class="side-col">
        <v-card class="summary">
          <div class="tx-hd"><h2>Summary</h2></div>
          <div class="kv"><span>Expenses this cycle</span><b class="num">{{ d.expenseCount }}</b></div>
          <div class="kv"><span>Largest expense</span><b class="num">{{ yen(d.largestJpy) }}</b></div>
          <div class="kv"><span>Average expense</span><b class="num">{{ avgExpenseJpy !== null ? yen(avgExpenseJpy) : '—' }}</b></div>
          <div class="kv"><span>Needs / wants</span><b class="num">{{ needPct !== null ? `${needPct}% / ${wantPct}%` : '—' }}</b></div>
        </v-card>
        <v-card>
          <div class="hd"><div><div class="eyebrow">Spend per cycle</div><div class="range" style="font-size: 15px">Last 12 cycles</div></div></div>
          <div class="bars-wrap">
            <Bar :data="barChartData" :options="barOptions" aria-hidden="true" role="presentation" />
          </div>
          <!-- Text/keyboard equivalent of the bar chart: every cycle's figure as a compact, visible
               link to the ledger filtered to it, same as clicking its bar would (spec §5.5). -->
          <ul class="cycle-links" aria-label="Cycle totals, each a link to the ledger filtered to that cycle">
            <li v-for="c in d.byCycle" :key="c.cycle">
              <router-link :to="ledgerLink(c.cycle)" :class="{ 'font-weight-bold': c.cycle === d.cycle }" :aria-label="`${cycleLabel(c.cycle, startDay)}: ${yen(c.spentJpy)}`">
                {{ monthOf(c.cycle) }} · {{ yen(c.spentJpy) }}
              </router-link>
            </li>
          </ul>
        </v-card>
      </div>
    </div>
  </template>
  <v-progress-linear v-else indeterminate />
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

.hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px 6px;
  flex-wrap: wrap;
}
.range {
  font-size: 18px;
  font-weight: 700;
  margin-top: 2px;
}

.spend-body {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 12px;
  align-items: center;
  padding: 6px 22px 18px;
}
@media (max-width: 1100px) {
  .spend-body {
    grid-template-columns: 1fr;
  }
}
.donut-wrap {
  position: relative;
  width: 260px;
  height: 260px;
  margin: 4px auto;
}
.donut-wrap .ctr {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  pointer-events: none;
}
.donut-wrap .ctr b {
  display: block;
  font-size: 24px;
  letter-spacing: -0.4px;
}
.donut-wrap .ctr span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.legend {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 10px;
}
@media (max-width: 1100px) {
  .legend {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .legend {
    grid-template-columns: 1fr;
  }
}
.lg {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 9px 12px;
  border-radius: 10px;
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface));
}
.lg:hover,
.lg:focus-visible,
.lg.hl {
  background: rgb(var(--v-theme-surface-variant));
}
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: none;
  margin-top: 5px;
}
.lg .n {
  font-weight: 500;
}
.lg .a {
  font-weight: 600;
}
.lg .a span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
  margin-top: 16px;
}
@media (max-width: 1100px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
}
.side-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
.tx-hd .right {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.summary .kv {
  display: flex;
  justify-content: space-between;
  padding: 11px 22px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.summary .kv span {
  color: rgb(var(--v-theme-on-surface-variant));
}

.bars-wrap {
  height: 170px;
  padding: 10px 18px 0;
}
.cycle-links {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 10px 18px 16px;
  margin: 0;
  font-size: 11.5px;
}
.cycle-links a {
  color: rgb(var(--v-theme-on-surface-variant));
  text-decoration: none;
}
.cycle-links a:hover,
.cycle-links a:focus-visible {
  text-decoration: underline;
}
</style>
