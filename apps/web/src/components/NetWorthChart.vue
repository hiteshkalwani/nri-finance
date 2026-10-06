<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { Line } from 'vue-chartjs'
import { CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js'
import { areaData, buildAreaOptions, prefersReducedMotion } from '../lib/charts'

ChartJS.register(CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip)

const props = defineProps<{ labels: string[]; values: number[]; formatValue: (n: number) => string }>()

// Resolved hex values (not CSS var() references) from the active theme, same reasoning as
// DashboardPage's own `themeHex`/`themeBorder`: a canvas fillStyle can't reliably resolve a CSS
// variable, and Chart.js only reads `options`/dataset colours once at render, so both must be
// `computed()` to pick up a theme flip at runtime.
const theme = useTheme()
const themeHex = (key: string): string => {
  const c = theme.current.value.colors[key]
  return typeof c === 'string' ? c : '#000000'
}
const themeBorder = (): string => {
  const v = theme.current.value.variables?.['border-color']
  return typeof v === 'string' ? v : '#000000'
}

// `primary-accent`, not `primary`: the fill/line is a non-text use and must stay the bright
// mockup accent in both themes (theme.ts) — see DashboardPage's matching comment on `barChartData`.
const chartData = computed(() => areaData(props.labels, props.values, themeHex('primary-accent')))
// A real person who set "reduce motion" in their OS gets the chart drawn complete, no animation —
// same reasoning the screenshot script relies on (scripts/ui-screens.mjs sets `reducedMotion:
// 'reduce'` on its pages) to never catch the ~1s draw-in mid-animation (fix round 1). Shared with
// the Dashboard's bar/donut charts via `prefersReducedMotion()` (fix round 1, continued) rather
// than each re-checking `matchMedia` inline.
const reducedMotion = prefersReducedMotion()
const chartOptions = computed(() => buildAreaOptions(themeHex('on-surface-variant'), themeBorder(), props.formatValue, reducedMotion))
</script>

<template>
  <div class="nwchart">
    <Line :data="chartData" :options="chartOptions" aria-hidden="true" role="presentation" />
  </div>
  <!-- Text/keyboard equivalent of the chart (spec §5): every point's figure as real, visible text. -->
  <ul class="nwchart-list" aria-label="Net worth by cycle">
    <li v-for="(label, i) in labels" :key="label">{{ label }}: {{ formatValue(values[i]!) }}</li>
  </ul>
</template>

<style scoped>
.nwchart {
  height: 220px;
  padding: 4px 18px 0;
}
.nwchart-list {
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
