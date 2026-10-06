import type { ChartOptions } from 'chart.js'
import type { Dashboard } from '@nri/contracts'
import type { LegendRow } from './legend'
import { yen } from './format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Appends a 2-digit hex alpha suffix to a 6-digit hex colour (canvas fillStyle supports 8-digit hex). */
function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
}

/**
 * Doughnut from the legend rows (already limit/"Everything else"-folded by `legendRows`), so a
 * slice's index always matches its legend row's index for hover/focus highlighting. `Category.color`
 * is a bare string on read (v1-imported colours pass through as stored), so an invalid one falls back
 * to `fallback` — the active theme's neutral colour, resolved by the caller via `useTheme()` since a
 * CSS variable reference isn't guaranteed to resolve inside a canvas fillStyle.
 */
export function donutData(rows: LegendRow[], fallback: string) {
  return {
    labels: rows.map((r) => r.name),
    datasets: [{ data: rows.map((r) => r.spentJpy), backgroundColor: rows.map((r) => (HEX.test(r.color) ? r.color : fallback)), borderWidth: 0 }],
  }
}

/**
 * Bars labelled by the cycle's closing month; the selected cycle in the active theme's `primary`
 * colour, the rest at 35% opacity of it (spec §4.1) — `primary` is resolved by the caller via
 * `useTheme()` so dark mode gets its own accent shade.
 */
export function barData(d: Dashboard, primary: string) {
  const muted = withAlpha(primary, 0.35)
  return {
    labels: d.byCycle.map((c) => MONTHS[Number(c.cycle.slice(5)) - 1]!),
    datasets: [{ data: d.byCycle.map((c) => c.spentJpy), backgroundColor: d.byCycle.map((c) => (c.cycle === d.cycle ? primary : muted)) }],
  }
}

/**
 * Options for the "Spend per cycle" bar chart. A plain function (not a `useTheme()`-reading
 * composable) so it's unit-testable without mounting Chart.js: `tickColor`/`gridColor` are
 * resolved by the caller from the active theme (same pattern as `barData`'s own `primary`
 * argument), and `onCycleClick` is a plain `(index: number) => void` rather than this module
 * reaching into the dashboard data or the router itself.
 *
 * Chart.js's own tick/grid-line defaults are dark-on-transparent — fine on the light theme's
 * white-ish canvas, but in dark mode they render as a near-invisible dark grey on the dark canvas
 * unless the options explicitly supply colours (finding 4). The caller must rebuild these options
 * (a `computed()`, not a plain object) whenever the theme changes, since Chart.js reads `options`
 * once at render and won't react to a CSS variable changing on its own.
 */
export function buildBarOptions(onCycleClick: (index: number) => void, tickColor: string, gridColor: string): ChartOptions<'bar'> {
  return {
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor, callback: (v) => yen(Number(v)) }, grid: { color: gridColor } },
    },
    onClick: (_e, els) => {
      const index = els[0]?.index
      if (index !== undefined) onCycleClick(index)
    },
  }
}

/**
 * The Accounts screen's net worth area chart (spec §4.1, mockup's `#nwchart`): a single filled
 * line, `lineColor` for the stroke and a 28%-alpha tint of it for the fill (Chart.js's own `fill`
 * option paints the dataset's `backgroundColor` under the line) — both resolved by the caller via
 * `useTheme()` (same pattern as `barData`'s `primary` argument) so dark mode gets its own shade.
 */
export function areaData(labels: string[], values: number[], lineColor: string) {
  return {
    labels,
    datasets: [{
      data: values,
      borderColor: lineColor,
      backgroundColor: withAlpha(lineColor, 0.28),
      fill: true,
      tension: 0.2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: lineColor,
      borderWidth: 2.5,
    }],
  }
}

/**
 * Options for the net worth area chart. `formatValue` lets the caller switch the y-axis/tooltip
 * between yen and rupees (the Accounts screen's "In ¥ / In ₹" toggle re-expresses the whole
 * chart, not just the headline total) without this module knowing about currencies at all.
 *
 * `reducedMotion` (fix round 1): the caller passes `window.matchMedia('(prefers-reduced-motion:
 * reduce)').matches` — Chart.js's default ~1s draw-in animation otherwise means the chart can
 * still be mid-animation (or, worse, not yet started) when something screenshots the page the
 * instant it settles, same as any other browser user who asked for reduced motion.
 */
export function buildAreaOptions(tickColor: string, gridColor: string, formatValue: (n: number) => string, reducedMotion = false): ChartOptions<'line'> {
  return {
    maintainAspectRatio: false,
    animation: reducedMotion ? false : undefined,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => formatValue(Number(ctx.parsed.y)) } },
    },
    scales: {
      x: { ticks: { color: tickColor }, grid: { display: false } },
      y: { ticks: { color: tickColor, callback: (v) => formatValue(Number(v)) }, grid: { color: gridColor } },
    },
  }
}
