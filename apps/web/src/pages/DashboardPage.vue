<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { Bar, Doughnut } from 'vue-chartjs'
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js'
import { Dashboard } from '@nri/contracts'
import { nextCycle, previousCycle } from '@nri/core'
import { apiFetch, ApiRequestError } from '../lib/api'
import { barData, donutData } from '../lib/charts'
import { cycleLabel, yen } from '../lib/format'
import { useProfile } from '../lib/profile'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const route = useRoute()
const router = useRouter()
const me = useProfile()
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
const ledgerLink = (categoryId: string) => ({ path: '/spend', query: { cycle: d.value!.cycle, categoryId } })

// Clicking a slice/bar is a mouse-only affordance on its own, so the chart's onClick handlers below
// are mirrored by real links/buttons in the text lists underneath each chart (DASH accessibility note).
const donutOptions = {
  plugins: { legend: { position: 'bottom' as const } },
  onClick: (_e: unknown, els: { index: number }[]) => {
    const c = d.value?.byCategory[els[0]?.index ?? -1]
    if (c) void router.push(ledgerLink(c.categoryId))
  },
}
const barOptions = {
  plugins: { legend: { display: false } },
  scales: { y: { ticks: { callback: (v: string | number) => yen(Number(v)) } } },
  onClick: (_e: unknown, els: { index: number }[]) => {
    const c = d.value?.byCycle[els[0]?.index ?? -1]
    if (c) void go(c.cycle)
  },
}
</script>

<template>
  <v-alert v-if="needsProfile" type="info" variant="tonal">
    Set up your profile first in <router-link to="/settings">Settings</router-link>, or import your v1 data there.
  </v-alert>
  <v-alert v-else-if="dash.error.value" type="error" variant="tonal">{{ dash.error.value.message }}</v-alert>
  <template v-else-if="d">
    <div class="d-flex align-center ga-2 mb-4">
      <v-btn icon="mdi-chevron-left" variant="text" aria-label="Previous cycle" @click="go(previousCycle(d.cycle))" />
      <h1 class="text-h6" data-testid="cycle-label">{{ cycleLabel(d.cycle, startDay) }}</h1>
      <v-btn icon="mdi-chevron-right" variant="text" aria-label="Next cycle" @click="go(nextCycle(d.cycle))" />
    </div>
    <v-row dense class="mb-4">
      <v-col cols="6" md="3"><v-card><v-card-text>
        <div class="text-caption">Income</div><div class="text-h6" data-testid="income">{{ yen(d.incomeJpy) }}</div>
      </v-card-text></v-card></v-col>
      <v-col cols="6" md="3"><v-card><v-card-text>
        <div class="text-caption">Spent</div><div class="text-h6" data-testid="spent">{{ yen(d.spentJpy) }}</div>
      </v-card-text></v-card></v-col>
      <v-col cols="6" md="3"><v-card><v-card-text>
        <div class="text-caption">Sent home</div><div class="text-h6" data-testid="sent">{{ yen(d.sentJpy) }}</div>
        <div v-if="d.feesJpy" class="text-caption text-medium-emphasis">fees {{ yen(d.feesJpy) }}</div>
      </v-card-text></v-card></v-col>
      <v-col cols="6" md="3"><v-card><v-card-text>
        <div class="text-caption">Kept</div>
        <!-- A negative balance is never shown by colour alone: the formatted amount keeps its minus sign too. -->
        <div class="text-h6" :class="{ 'text-error': d.keptJpy < 0 }" data-testid="kept">{{ yen(d.keptJpy) }}</div>
        <div v-if="d.savingsRatePct !== null" class="text-caption">savings rate {{ d.savingsRatePct }}%</div>
      </v-card-text></v-card></v-col>
    </v-row>
    <v-row>
      <v-col cols="12" md="5">
        <v-card>
          <v-card-title class="text-subtitle-1">Spending by category</v-card-title>
          <v-card-text>
            <template v-if="d.byCategory.length">
              <Doughnut :data="donutData(d)" :options="donutOptions" aria-hidden="true" role="presentation" />
              <!-- Text/keyboard equivalent of the donut: every slice's figures as a list of real links,
                   each reaching the same filtered ledger a slice click would (DASH-3 accessibility note). -->
              <ul class="chart-legend-list" aria-label="Category totals, each a link to the filtered ledger">
                <li v-for="c in d.byCategory" :key="c.categoryId">
                  <router-link :to="ledgerLink(c.categoryId)" class="d-flex align-center ga-2">
                    <v-icon size="x-small" :color="c.color">mdi-circle</v-icon>
                    <span class="mr-auto">{{ c.name }}</span>
                    <span>{{ yen(c.spentJpy) }}</span>
                  </router-link>
                </li>
              </ul>
            </template>
            <p v-else>No spending recorded in this cycle.</p>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="7">
        <v-card>
          <v-card-title class="text-subtitle-1">Spend per cycle</v-card-title>
          <v-card-text>
            <Bar :data="barData(d, '#1976d2', '#90caf9')" :options="barOptions" aria-hidden="true" role="presentation" />
            <!-- Text/keyboard equivalent of the bar chart: every cycle's figure as a button that jumps
                 the dashboard to it, same as clicking its bar would. -->
            <ul class="chart-legend-list" aria-label="Cycle totals, each a button to switch to that cycle">
              <li v-for="c in d.byCycle" :key="c.cycle">
                <button type="button" class="d-flex align-center ga-2 w-100" :class="{ 'font-weight-bold': c.cycle === d.cycle }" @click="go(c.cycle)">
                  <span class="mr-auto">{{ cycleLabel(c.cycle, startDay) }}</span>
                  <span>{{ yen(c.spentJpy) }}</span>
                </button>
              </li>
            </ul>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </template>
  <v-progress-linear v-else indeterminate />
</template>

<style scoped>
.chart-legend-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.chart-legend-list li + li {
  margin-top: 4px;
}
.chart-legend-list a,
.chart-legend-list button {
  display: flex;
  width: 100%;
  padding: 4px 2px;
  color: inherit;
  text-decoration: none;
  background: none;
  border: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.chart-legend-list a:hover,
.chart-legend-list button:hover {
  text-decoration: underline;
}
</style>
