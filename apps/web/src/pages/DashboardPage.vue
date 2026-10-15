<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay, useTheme } from 'vuetify'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Bar, Doughnut } from 'vue-chartjs'
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js'
import type { ChartComponentRef } from 'vue-chartjs'
import { CycleIncome, Dashboard, NetWorthResponse, TransactionPage } from '@nri/contracts'
import { nextCycle, previousCycle } from '@nri/core'
import ExpenseRow from '../components/ExpenseRow.vue'
import NetWorthEmergencyFundCards from '../components/NetWorthEmergencyFundCards.vue'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { parseAmount } from '../lib/balancesForm'
import { useCategories } from '../lib/categories'
import { barData, buildBarOptions, buildDonutOptions, donutData, prefersReducedMotion } from '../lib/charts'
import { safeColor } from '../lib/color'
import { cycleLabel, dateRangeLabel, monthYearLabel, MONTHS, rupees, yen } from '../lib/format'
import { groupByDate, isPartialPageGroup, pageCount } from '../lib/groups'
import { legendRows } from '../lib/legend'
import { useProfile } from '../lib/profile'
import { PURPOSE_LABELS } from '../lib/remittanceForm'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const { xs } = useDisplay()
const theme = useTheme()
const me = useProfile()
const cats = useCategories()
// Shared with NetWorthChart.vue's area chart (fix round 1): read once, passed into every chart's
// options builder below, rather than each one re-checking `matchMedia` (or, worse, not checking
// it at all — see the doc comments on `buildBarOptions`/`buildDonutOptions`).
const reducedMotion = prefersReducedMotion()

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

const RECENT_PAGE_SIZE = 5
const recentCycle = computed(() => d.value?.cycle ?? '')
const recent = useQuery({
  queryKey: ['transactions', 'recent', recentCycle],
  queryFn: () => apiFetch(`/api/transactions?cycle=${recentCycle.value}&pageSize=${RECENT_PAGE_SIZE}`, {}, TransactionPage),
  enabled: () => !!d.value,
  placeholderData: keepPreviousData,
})
const recentGroups = computed(() => groupByDate(recent.data.value?.items ?? []))

// Net worth / emergency fund cards (spec §4.4): the Dashboard's own *resolved* cycle (`d.value.cycle`),
// not the raw route query (which may be empty, letting the API default it) — same reasoning as
// `recentCycle` above. `span=6` is fixed (no selector on the Dashboard); invalidating the broad
// `['networth']` prefix from Accounts/Update balances still covers this query.
const netWorthCycle = computed(() => d.value?.cycle ?? '')
const networthQ = useQuery({
  queryKey: ['networth', netWorthCycle, 6],
  queryFn: () => apiFetch(`/api/networth?cycle=${netWorthCycle.value}&span=6`, {}, NetWorthResponse),
  enabled: () => !!d.value,
  placeholderData: keepPreviousData,
})
const nw = computed(() => networthQ.data.value ?? null)
// This card only ever shows the most recent `RECENT_PAGE_SIZE` rows (there's no pager here, unlike
// the ledger) — when the cycle has more than that, the last day group on screen may be a partial
// day, same risk Spend's own groups carry at a page boundary. Reuses `isPartialPageGroup` as if
// this were "page 1 of N" over that same page size, which is exactly what it is.
const recentTotalPages = computed(() => pageCount(recent.data.value?.total ?? 0, RECENT_PAGE_SIZE))
function isPartialRecentGroup(i: number): boolean {
  return isPartialPageGroup(i, recentGroups.value.length, recentTotalPages.value, 1)
}

// Summary card derived figures — guarded against a zero denominator rather than showing NaN/Infinity.
const avgExpenseJpy = computed(() => (d.value && d.value.expenseCount > 0 ? Math.round(d.value.spentJpy / d.value.expenseCount) : null))
const needPct = computed(() => (d.value && d.value.spentJpy > 0 ? Math.round((d.value.needJpy / d.value.spentJpy) * 100) : null))
const wantPct = computed(() => (d.value && d.value.spentJpy > 0 ? Math.round((d.value.wantJpy / d.value.spentJpy) * 100) : null))
const spentPct = computed(() => (d.value && d.value.incomeJpy > 0 ? Math.round((d.value.spentJpy / d.value.incomeJpy) * 1000) / 10 : null))

// Spending-by-category: legend rows (limit/"Everything else"-folded, unless expanded) drive both the
// legend list and the donut's slices, so a slice's index always matches its legend row for
// hover/focus highlighting. "Show all categories" expands to every category (limit Infinity); the
// toggle itself only appears once there's actually a tail to fold (spec §4.1).
const LEGEND_LIMIT = 9
const expanded = ref(false)
const legend = computed(() => (d.value ? legendRows(d.value.byCategory, expanded.value ? Infinity : LEGEND_LIMIT) : []))
const hasMoreCategories = computed(() => (d.value?.byCategory.length ?? 0) > LEGEND_LIMIT)
// Collapse back to the folded view on every cycle change, so switching cycles never leaves an
// expanded legend whose category count no longer matches the new cycle's data.
watch(() => d.value?.cycle, () => { expanded.value = false })

const donutRef = ref<ChartComponentRef<'doughnut'> | null>(null)
const hoveredLegend = ref<number | null>(null)
function clearChartHighlight() {
  const chart = donutRef.value?.chart
  if (!chart) return
  chart.setActiveElements([])
  chart.update()
}
function highlightSlice(i: number) {
  hoveredLegend.value = i
  const chart = donutRef.value?.chart
  if (!chart) return
  chart.setActiveElements([{ datasetIndex: 0, index: i }])
  chart.update()
}
function clearSliceHighlight() {
  hoveredLegend.value = null
  clearChartHighlight()
}
// Defensive reset: whenever the legend's own data changes (a new cycle's figures, or expanding/
// collapsing — both produce a new `legend` array), any previously-hovered/focused index may no
// longer mean the same row, or nothing may be hovering it any more at all. Clearing here, rather
// than relying solely on mouseleave/blur, keeps a cycle switch (or an expand/collapse) from ever
// leaving a stale highlight on screen.
watch(legend, () => {
  hoveredLegend.value = null
  clearChartHighlight()
})
// Charts read colours from the active theme (useTheme()) so dark mode gets its own accent/neutral
// shades; these are resolved hex values, not CSS variable references, since a canvas fillStyle isn't
// guaranteed to resolve var() the way a DOM element's style would. Vuetify's `Color` type also allows
// non-string forms (number/HSV/RGB), which our own theme.ts never uses, so narrow to the plain hex string.
const themeHex = (key: string): string => {
  const c = theme.current.value.colors[key]
  return typeof c === 'string' ? c : '#000000'
}
const donutChartData = computed(() => donutData(legend.value, themeHex('on-surface-variant')))
const donutOptions = computed(() => buildDonutOptions(
  (index) => { hoveredLegend.value = index },
  (index) => {
    const row = legend.value[index]
    if (row && d.value) void router.push(ledgerLink(d.value.cycle, row.categoryId))
  },
  reducedMotion,
))

// `primary-accent`, not `primary`: the bars are a non-text use and must stay the bright mockup
// accent in both themes (theme.ts) — `primary` in light theme is now the deeper button-fill shade.
const barChartData = computed(() => (d.value ? barData(d.value, themeHex('primary-accent')) : { labels: [], datasets: [] }))
// `border-color` lives in the theme's `variables`, not its `colors` (theme.ts) — `variables` isn't
// typed as holding colour strings generically (e.g. `border-opacity` is a number), so this is
// narrowed the same defensive way `themeHex` narrows `colors`.
const themeBorder = (): string => {
  const v = theme.current.value.variables?.['border-color']
  return typeof v === 'string' ? v : '#000000'
}
// A `computed`, not a plain object (finding 4): Chart.js reads `options` once at render and won't
// react to a CSS variable changing on its own, so this must rebuild — with freshly-resolved hex
// colours, not CSS var() references a canvas fillStyle can't reliably use — whenever the theme
// flips. Ticks use the muted-text token and grid lines the border token so both stay legible
// against dark mode's own canvas, instead of Chart.js's light-mode-only built-in defaults.
const barOptions = computed(() => buildBarOptions(
  (index) => {
    const c = d.value?.byCycle[index]
    if (c) void router.push(ledgerLink(c.cycle))
  },
  themeHex('on-surface-variant'),
  themeBorder(),
  reducedMotion,
))

// Income KPI's "Edit income for <Mon YYYY>" dialog (DASH-4): a typed amount overrides the cycle's
// income (profile salary); "Use salary" (PUT null) clears the override. Same field-error-free
// shape as AccountsPage's own emergency-fund-goal dialog, since there's only ever this one field.
const incomeDialogOpen = ref(false)
const incomeInput = ref('')
const incomeError = ref('')
function openIncomeDialog() {
  incomeInput.value = d.value?.incomeOverridden ? String(d.value.incomeJpy) : ''
  incomeError.value = ''
  saveIncome.reset()
  incomeDialogOpen.value = true
}
const saveIncome = useMutation({
  mutationFn: (incomeJpy: number | null) =>
    apiFetch(`/api/cycles/${d.value!.cycle}/income`, { method: 'PUT', body: JSON.stringify({ incomeJpy }) }, CycleIncome),
  onSuccess: async () => {
    await qc.invalidateQueries({ queryKey: ['dashboard'] })
    incomeDialogOpen.value = false
  },
})
function submitIncome() {
  const parsed = parseAmount(incomeInput.value, 'JPY')
  if (parsed === 'invalid') {
    incomeError.value = 'Enter a whole number of yen, 0 or more.'
    return
  }
  incomeError.value = ''
  saveIncome.mutate(parsed)
}
function useSalary() {
  incomeError.value = ''
  saveIncome.mutate(null)
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
        <div class="l">
          Income
          <v-btn
            icon="mdi-pencil-outline" variant="text" size="x-small" density="compact" class="income-edit"
            :aria-label="`Edit income for ${monthYearLabel(d.cycle)}`" @click="openIncomeDialog"
          />
        </div>
        <div class="v num" data-testid="income">{{ yen(d.incomeJpy) }}</div>
        <div v-if="d.incomeOverridden" class="s">override</div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Spent</div>
        <div class="v num" data-testid="spent">{{ yen(d.spentJpy) }}</div>
        <div v-if="spentPct !== null" class="s">{{ spentPct }}% of income</div>
        <div v-if="spentPct !== null" class="bar-mini"><i :style="{ width: `${Math.min(spentPct, 100)}%`, background: 'rgb(var(--v-theme-primary-accent))' }" /></div>
      </v-card>
      <v-card class="kpi">
        <div class="l">Sent home</div>
        <div class="v num" data-testid="sent">{{ yen(d.sentJpy) }}</div>
        <div v-if="d.sentJpy" class="s">{{ rupees(d.receivedPaise) }} received<span v-if="d.feesJpy"> · fees {{ yen(d.feesJpy) }}</span></div>
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
          <!-- `success-accent`/`error-accent`, not `success`/`error`: this bar is a non-text fill
               and must stay the bright colour in both themes (theme.ts) — `success`/`error` are
               the deeper text-safe shades used by the sub-line's text above (spec §7). -->
          <i :style="{ width: `${Math.min(Math.abs(d.savingsRatePct), 100)}%`, background: d.savingsRatePct >= 0 ? 'rgb(var(--v-theme-success-accent))' : 'rgb(var(--v-theme-error-accent))' }" />
        </div>
      </v-card>
    </div>

    <!-- Phones (spec §4.4): the net worth / emergency fund cards sit right after the KPIs, ahead
         of everything else — the wide layout's own copies (below, in `.side-col`) are hidden here. -->
    <div v-if="xs" class="mobile-nw-ef">
      <NetWorthEmergencyFundCards :nw="nw" />
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
               Hovering/focusing a legend item highlights its slice (Chart.js setActiveElements), and
               hovering a slice highlights its legend item back (Chart.js onHover). -->
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
            <button v-if="hasMoreCategories" type="button" class="legend-more" :aria-expanded="expanded" @click="expanded = !expanded">
              {{ expanded ? 'Show fewer' : 'Show all categories' }} <span aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span>
            </button>
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
          <div role="list" aria-label="Recent expenses">
            <template v-for="(g, i) in recentGroups" :key="g.date">
              <div class="day-row">
                <span>{{ g.label }}</span>
                <span class="num">{{ yen(g.totalJpy) }}{{ isPartialRecentGroup(i) ? ' · latest 5' : '' }}</span>
              </div>
              <!-- See LedgerPage.vue's matching comment: wraps (rather than is) each ExpenseRow,
                   so its router-link root keeps its native link role instead of having it
                   overwritten by this list's own role="listitem". -->
              <div v-for="t in g.rows" :key="t.id" role="listitem"><ExpenseRow :t="t" :category="catOf(t.categoryId)" /></div>
            </template>
          </div>
        </template>
        <p v-else class="pa-5 mb-0 text-medium-emphasis">No expenses recorded in this cycle yet.</p>
      </v-card>
      <div class="side-col">
        <!-- Wide layout (spec §4.4): these cards sit above Summary; on phones they instead render
             right after the KPIs, above (see `.mobile-nw-ef`). -->
        <NetWorthEmergencyFundCards v-if="!xs" :nw="nw" />
        <v-card class="summary">
          <div class="tx-hd"><h2>Summary</h2></div>
          <div class="kv"><span>Expenses this cycle</span><b class="num">{{ d.expenseCount }}</b></div>
          <div class="kv"><span>Largest expense</span><b class="num">{{ yen(d.largestJpy) }}</b></div>
          <div class="kv"><span>Average expense</span><b class="num">{{ avgExpenseJpy !== null ? yen(avgExpenseJpy) : '—' }}</b></div>
          <div class="kv"><span>Needs / wants</span><b class="num">{{ needPct !== null ? `${needPct}% / ${wantPct}%` : '—' }}</b></div>
        </v-card>
        <!-- Hidden when nothing was sent this cycle (spec §4.4). -->
        <v-card v-if="d.sentByPurpose.length">
          <div class="tx-hd"><h2>Sent home by purpose</h2></div>
          <div v-for="p in d.sentByPurpose" :key="p.purpose" class="kv">
            <span>{{ PURPOSE_LABELS[p.purpose] }}</span>
            <b class="num">{{ yen(p.jpySent) }}<small class="ml-1 text-medium-emphasis">{{ rupees(p.inrPaise) }}</small></b>
          </div>
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

    <v-dialog v-model="incomeDialogOpen" max-width="360">
      <v-card>
        <div class="tx-hd"><h2>Income for {{ monthYearLabel(d.cycle) }}</h2></div>
        <v-form class="px-5" @submit.prevent="submitIncome">
          <v-text-field
            id="income-amount" v-model="incomeInput" label="Income (¥)" inputmode="decimal"
            :error-messages="incomeError ? [incomeError] : []"
          />
        </v-form>
        <v-alert v-if="saveIncome.error.value" type="error" variant="tonal" class="mx-5 mb-3">{{ saveIncome.error.value.message }}</v-alert>
        <v-card-actions class="px-5 pb-5">
          <v-btn variant="text" :loading="saveIncome.isPending.value" @click="useSalary">Use salary</v-btn>
          <v-spacer />
          <v-btn variant="outlined" @click="incomeDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saveIncome.isPending.value" @click="submitIncome">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
}
.income-edit {
  opacity: var(--v-medium-emphasis-opacity);
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

.mobile-nw-ef {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
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
.legend-more {
  grid-column: 1 / -1;
  justify-self: center;
  margin-top: 6px;
  padding: 4px 8px;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-secondary));
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.legend-more:hover,
.legend-more:focus-visible {
  text-decoration: underline;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
  margin-top: 16px;
}
@media (max-width: 1100px) {
  .grid2 {
    /* Defensive (fix round 1, cheap extra): `minmax(0, 1fr)`, not bare `1fr` — Settings'
       `.grid2` hit the exact same bug (see SettingsPage.vue's matching comment) once a row's
       content had a wide enough min-content to bubble up through this track. Nothing here is
       that wide yet, but the pattern is identical and just as unguarded. */
    grid-template-columns: minmax(0, 1fr);
  }
}
.grid2 > .v-card {
  min-width: 0;
}
.side-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
