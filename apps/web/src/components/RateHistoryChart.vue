<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { Line } from 'vue-chartjs'
import { CategoryScale, Chart as ChartJS, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js'
import { buildRateHistoryOptions, prefersReducedMotion, rateHistoryData } from '../lib/charts'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip)

const props = defineProps<{ points: { sentOn: string; rate: string }[]; planningRate: string }>()

// Same reasoning as NetWorthChart.vue: resolved hex values (not CSS var() references), since a
// canvas fillStyle can't reliably resolve one, and Chart.js only reads colours/options once.
const theme = useTheme()
const themeHex = (key: string): string => {
  const c = theme.current.value.colors[key]
  return typeof c === 'string' ? c : '#000000'
}
const themeBorder = (): string => {
  const v = theme.current.value.variables?.['border-color']
  return typeof v === 'string' ? v : '#000000'
}

const chartData = computed(() => rateHistoryData(props.points, props.planningRate, themeHex('primary-accent'), themeHex('on-surface-variant')))
const reducedMotion = prefersReducedMotion()
const chartOptions = computed(() => buildRateHistoryOptions(themeHex('on-surface-variant'), themeBorder(), reducedMotion))
</script>

<template>
  <div class="ratechart">
    <Line :data="chartData" :options="chartOptions" aria-hidden="true" role="presentation" />
  </div>
  <!-- Text/keyboard equivalent of the chart (spec §5): every transfer's rate as real, visible text. -->
  <ul class="ratechart-list" aria-label="Effective rate by transfer date">
    <li v-for="p in points" :key="p.sentOn">{{ p.sentOn }}: ¥{{ Number(p.rate).toFixed(4) }}</li>
  </ul>
</template>

<style scoped>
.ratechart {
  height: 200px;
  padding: 4px 18px 0;
}
.ratechart-list {
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
