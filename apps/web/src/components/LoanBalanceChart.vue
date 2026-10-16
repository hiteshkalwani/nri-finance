<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { Line } from 'vue-chartjs'
import { CategoryScale, Chart as ChartJS, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js'
import { buildLoanBalanceOptions, loanBalanceData, prefersReducedMotion } from '../lib/charts'
import { monthYearLabel, rupees } from '../lib/format'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip)

// Yearly-sampled rows (lib/loanForm.ts's `yearlyRows`) — the caller passes those, not every month.
const props = defineProps<{
  planRows: { cycle: string; closingPaise: number }[]
  projectedRows: { cycle: string; closingPaise: number }[]
}>()

// Same reasoning as RateHistoryChart/NetWorthChart: resolved hex values, not CSS var() references.
const theme = useTheme()
const themeHex = (key: string): string => {
  const c = theme.current.value.colors[key]
  return typeof c === 'string' ? c : '#000000'
}
const themeBorder = (): string => {
  const v = theme.current.value.variables?.['border-color']
  return typeof v === 'string' ? v : '#000000'
}

const chartData = computed(() => loanBalanceData(props.planRows, props.projectedRows, themeHex('on-surface-variant'), themeHex('primary-accent')))
const reducedMotion = prefersReducedMotion()
const chartOptions = computed(() => buildLoanBalanceOptions(themeHex('on-surface-variant'), themeBorder(), reducedMotion))
const listCycles = computed(() => (props.planRows.length >= props.projectedRows.length ? props.planRows : props.projectedRows).map((r) => r.cycle))
</script>

<template>
  <div class="loanchart">
    <Line :data="chartData" :options="chartOptions" aria-hidden="true" role="presentation" />
  </div>
  <!-- Text/keyboard equivalent of the chart (spec §5): plan vs actual+plan balance, year by year. -->
  <ul class="loanchart-list" aria-label="Loan balance, plan vs actual, by year">
    <li v-for="(cycle, i) in listCycles" :key="cycle">
      {{ monthYearLabel(cycle) }}: plan {{ planRows[i] ? rupees(planRows[i]!.closingPaise) : '—' }} · actual+plan {{ projectedRows[i] ? rupees(projectedRows[i]!.closingPaise) : '—' }}
    </li>
  </ul>
</template>

<style scoped>
.loanchart {
  height: 220px;
  padding: 4px 18px 0;
}
.loanchart-list {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 10px 18px 16px;
  margin: 0;
  font-size: 11.5px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
