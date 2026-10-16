<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js'
import type { SipYear } from '@nri/core'
import { buildSipProjectionOptions, prefersReducedMotion, sipProjectionData } from '../lib/charts'
import { rupees } from '../lib/format'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps<{ years: SipYear[] }>()

// Same reasoning as the other charts: resolved hex values, not CSS var() references.
const theme = useTheme()
const themeHex = (key: string): string => {
  const c = theme.current.value.colors[key]
  return typeof c === 'string' ? c : '#000000'
}
const themeBorder = (): string => {
  const v = theme.current.value.variables?.['border-color']
  return typeof v === 'string' ? v : '#000000'
}

// `primary-accent`/`success-accent`: non-text fills, must stay the bright mockup accents in both themes (theme.ts) —
// there's no separate purple/orange token pair, so this reuses the two accents already used for bars elsewhere.
const chartData = computed(() => sipProjectionData(props.years, themeHex('primary-accent'), themeHex('success-accent')))
const reducedMotion = prefersReducedMotion()
const chartOptions = computed(() => buildSipProjectionOptions(themeHex('on-surface-variant'), themeBorder(), reducedMotion))
</script>

<template>
  <div class="sipchart">
    <Bar :data="chartData" :options="chartOptions" aria-hidden="true" role="presentation" />
  </div>
  <!-- Text/keyboard equivalent of the chart (spec §5): each year's SIP + redirected-EMI corpus. -->
  <ul class="sipchart-list" aria-label="Projected corpus by year, SIP plus EMI redirected">
    <li v-for="y in years" :key="y.year">{{ y.year }}: {{ rupees(y.sipCorpusPaise + y.emiCorpusPaise) }}</li>
  </ul>
</template>

<style scoped>
.sipchart {
  height: 220px;
  padding: 4px 18px 0;
}
.sipchart-list {
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
