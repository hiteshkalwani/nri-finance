import type { ChartOptions } from 'chart.js'
import type { Dashboard } from '@nri/contracts'
import type { SipYear } from '@nri/core'
import type { LegendRow } from './legend'
import { rupees, yen } from './format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Appends a 2-digit hex alpha suffix to a 6-digit hex colour (canvas fillStyle supports 8-digit hex). */
function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
}

/**
 * Whether the OS/browser has "reduce motion" switched on (fix round 1) — guarded the same way
 * `NetWorthChart.vue` originally checked it inline, since `window`/`matchMedia` aren't guaranteed
 * to exist (SSR, or this file's own unit tests). Every chart's options builder below takes a
 * `reducedMotion` flag rather than calling this itself, so each stays a plain, themeless,
 * unit-testable function (same reasoning `buildAreaOptions`' own doc comment already gives) — the
 * caller reads this once and passes the result in, same pattern as `tickColor`/`gridColor`.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
 *
 * `reducedMotion` (fix round 1): same reasoning as `buildAreaOptions`' own — without it, Chart.js's
 * default ~1s draw-in animation means the bars can still be empty/mid-draw the instant something
 * screenshots the page (`scripts/ui-screens.mjs` sets `reducedMotion: 'reduce'` on its pages
 * expecting exactly this).
 */
export function buildBarOptions(onCycleClick: (index: number) => void, tickColor: string, gridColor: string, reducedMotion = false): ChartOptions<'bar'> {
  return {
    maintainAspectRatio: false,
    animation: reducedMotion ? false : undefined,
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
 * Options for the Dashboard's "Spending by category" donut (spec §4.1's `#spend-donut`-equivalent).
 * A plain function, not a `useTheme()`-reading composable, for the same testability reason
 * `buildBarOptions` already gives — `onHover`/`onClick` are plain callbacks rather than this module
 * reaching into the dashboard's legend data or the router itself.
 *
 * `reducedMotion` (fix round 1): same as `buildBarOptions`/`buildAreaOptions` — otherwise the
 * slices can still be empty/mid-draw the instant the page is screenshotted.
 */
export function buildDonutOptions(onHover: (index: number | null) => void, onClick: (index: number) => void, reducedMotion = false): ChartOptions<'doughnut'> {
  return {
    cutout: '70%',
    animation: reducedMotion ? false : undefined,
    plugins: { legend: { display: false } },
    elements: { arc: { hoverOffset: 10 } },
    // Chart.js already highlights the hovered slice itself (built-in canvas hover interaction);
    // `onHover` just mirrors that index back to the caller, so it can highlight the matching
    // legend row too.
    onHover: (_e, active) => onHover(active[0]?.index ?? null),
    onClick: (_e, els) => {
      const index = els[0]?.index
      if (index !== undefined) onClick(index)
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
      // A lone value has no line segment to draw (Chart.js needs 2+ points for a line), so with
      // points hidden (0) a single-cycle chart rendered nothing at all (final review finding 3) —
      // the point marker itself becomes the visible mark in that one-point case.
      pointRadius: values.length === 1 ? 4 : 0,
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
/**
 * Remit's rate-history chart (mockup `#ratechart`): the actual effective rate of each of the last
 * N transfers, plus a second, dashed, flat series at the planning rate — same two-dataset shape
 * as the mockup's own `lineChart` helper, built as plain Chart.js data rather than a new
 * abstraction. `lineColor` is the actual-rate line; `dashColor` the planning line.
 */
export function rateHistoryData(points: { sentOn: string; rate: string }[], planningRate: string, lineColor: string, dashColor: string) {
  const vals = points.map((p) => Number(p.rate))
  return {
    labels: points.map((p) => p.sentOn),
    datasets: [
      { data: vals, borderColor: lineColor, backgroundColor: lineColor, tension: 0.15, pointRadius: vals.length === 1 ? 4 : 2, borderWidth: 2.5 },
      { data: vals.map(() => Number(planningRate)), borderColor: dashColor, borderDash: [5, 4], borderWidth: 1.6, pointRadius: 0 },
    ],
  }
}

/** Options for `rateHistoryData`'s chart; tooltip/y-axis show 4 decimals, matching the rest of the UI. */
export function buildRateHistoryOptions(tickColor: string, gridColor: string, reducedMotion = false): ChartOptions<'line'> {
  return {
    maintainAspectRatio: false,
    animation: reducedMotion ? false : undefined,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `¥${Number(ctx.parsed.y).toFixed(4)}` } } },
    scales: {
      x: { ticks: { color: tickColor }, grid: { display: false } },
      y: { ticks: { color: tickColor, callback: (v) => `¥${Number(v).toFixed(2)}` }, grid: { color: gridColor } },
    },
  }
}

/**
 * Loan page's "Balance · plan vs actual" chart (mockup's `#loanchart`): the original plan's
 * closing balance against the projected (actual-to-date + plan for the rest) schedule's, both
 * keyed by month index from `startCycle` so they line up even once the projected line pays off
 * sooner — the shorter series is padded with `null`s (a real gap Chart.js just stops drawing at,
 * same convention the mockup's own SVG trails with `null`s) rather than extended with zeros,
 * which would misread as "still owing nothing" past payoff.
 */
export function loanBalanceData(planRows: { cycle: string; closingPaise: number }[], projectedRows: { cycle: string; closingPaise: number }[], planColor: string, actualColor: string) {
  const labels = (planRows.length >= projectedRows.length ? planRows : projectedRows).map((r) => r.cycle)
  const pad = (rows: { closingPaise: number }[]) => labels.map((_, i) => rows[i]?.closingPaise ?? null)
  return {
    labels,
    datasets: [
      { label: 'Original plan', data: pad(planRows), borderColor: planColor, borderDash: [6, 5], borderWidth: 2, pointRadius: 0 },
      { label: 'Actual + plan', data: pad(projectedRows), borderColor: actualColor, borderWidth: 2.5, pointRadius: 0 },
    ],
  }
}

/** Options for `loanBalanceData`'s chart; the y-axis/tooltip show ₹, and ticks are thinned since a multi-year loan has many months. */
export function buildLoanBalanceOptions(tickColor: string, gridColor: string, reducedMotion = false): ChartOptions<'line'> {
  return {
    maintainAspectRatio: false,
    animation: reducedMotion ? false : undefined,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => rupees(Number(ctx.parsed.y)) } } },
    scales: {
      x: { ticks: { color: tickColor, maxTicksLimit: 12 }, grid: { display: false } },
      y: { ticks: { color: tickColor, callback: (v) => rupees(Number(v)) }, grid: { color: gridColor } },
    },
  }
}

/**
 * SIP page's "Projection" stacked bar (mockup's `#sipbars`): SIP corpus and EMI-redirected corpus
 * per year, stacked so their sum reads as the year's total projected corpus.
 */
export function sipProjectionData(years: SipYear[], sipColor: string, emiColor: string) {
  return {
    labels: years.map((y) => String(y.year)),
    datasets: [
      { label: 'SIP', data: years.map((y) => y.sipCorpusPaise), backgroundColor: sipColor },
      { label: 'EMI redirected', data: years.map((y) => y.emiCorpusPaise), backgroundColor: emiColor },
    ],
  }
}

/** Options for `sipProjectionData`'s stacked bar; both axes stacked, y-axis/tooltip in ₹. */
export function buildSipProjectionOptions(tickColor: string, gridColor: string, reducedMotion = false): ChartOptions<'bar'> {
  return {
    maintainAspectRatio: false,
    animation: reducedMotion ? false : undefined,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${rupees(Number(ctx.parsed.y))}` } } },
    scales: {
      x: { stacked: true, ticks: { color: tickColor }, grid: { display: false } },
      y: { stacked: true, ticks: { color: tickColor, callback: (v) => rupees(Number(v)) }, grid: { color: gridColor } },
    },
  }
}

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
