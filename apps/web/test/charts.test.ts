import { expect, it, vi } from 'vitest'
import { areaData, barData, buildAreaOptions, buildBarOptions, donutData } from '../src/lib/charts'

const d = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', incomeJpy: 1, spentJpy: 2500, sentJpy: 0, feesJpy: 0, keptJpy: 0, savingsRatePct: 0,
  expenseCount: 2, largestJpy: 2000, needJpy: 2500, wantJpy: 0,
  byCategory: [{ categoryId: 'a', name: 'Food', color: '#4caf50', spentJpy: 2000 }, { categoryId: 'b', name: 'Rent', color: '#2196f3', spentJpy: 500 }],
  byCycle: [{ cycle: '2026-09', spentJpy: 1000 }, { cycle: '2026-10', spentJpy: 2500 }],
}

const rows = [
  { categoryId: 'a', name: 'Food', color: '#4caf50', spentJpy: 2000, pct: 80 },
  { categoryId: null, name: 'Everything else', color: 'not-a-colour', spentJpy: 500, pct: 20 },
]

it('builds the donut from legend rows, falling back to the given colour for an invalid category colour', () => {
  expect(donutData(rows, '#999999')).toEqual({
    labels: ['Food', 'Everything else'],
    datasets: [{ data: [2000, 500], backgroundColor: ['#4caf50', '#999999'], borderWidth: 0 }],
  })
})

it('builds the bar from cycles, the selected cycle in the given primary colour and the rest at 35% opacity of it', () => {
  const b = barData(d, '#f0682e')
  expect(b.labels).toEqual(['Sep', 'Oct'])
  expect(b.datasets[0]!.data).toEqual([1000, 2500])
  expect(b.datasets[0]!.backgroundColor).toEqual(['#f0682e59', '#f0682e'])
})

// Finding 4: Chart.js's own built-in tick/grid-line defaults are dark-on-transparent, so in dark
// mode they render as near-invisible dark grey on the dark canvas unless the options explicitly
// supply colours from the active theme — `buildBarOptions` takes those two colours as plain
// arguments (resolved by the caller via useTheme(), same as barData's own `primary` argument)
// rather than reading them itself, so it stays a pure, themeless function to unit-test here.
it('reads tick and grid colours from the given theme tokens, not Chart.js defaults', () => {
  const opts = buildBarOptions(() => undefined, '#efece6', '#2e2c29')
  expect(opts.scales!.y!.ticks!.color).toBe('#efece6')
  expect(opts.scales!.x!.ticks!.color).toBe('#efece6')
  expect(opts.scales!.y!.grid!.color).toBe('#2e2c29')
  expect(opts.scales!.x!.grid!.color).toBe('#2e2c29')
})

it('still formats the y-axis ticks as yen and wires the click-through to the ledger', () => {
  const onCycleClick = vi.fn()
  const opts = buildBarOptions(onCycleClick, '#1d1d1f', '#ebe7e1')
  expect(opts.scales!.y!.ticks!.callback!.call({} as never, 2500, 0, [])).toBe('￥2,500')
  opts.onClick!({} as never, [{ index: 0 } as never], {} as never)
  expect(onCycleClick).toHaveBeenCalledWith(0)
})

// Accounts screen's net worth chart (spec §4.1): a single filled line/area, the fill a 28%-alpha
// tint of the given line colour (Chart.js's `fill: true` paints `backgroundColor` under the line).
it('builds a single filled area dataset from the series, with a translucent tint of the given colour', () => {
  const a = areaData(['Sep 2026', 'Oct 2026'], [620000, 1429069], '#f0682e')
  expect(a.labels).toEqual(['Sep 2026', 'Oct 2026'])
  expect(a.datasets[0]!.data).toEqual([620000, 1429069])
  expect(a.datasets[0]!.borderColor).toBe('#f0682e')
  expect(a.datasets[0]!.backgroundColor).toBe('#f0682e47')
  expect(a.datasets[0]!.fill).toBe(true)
})

it("area options read tick/grid colours from the given theme tokens and format values through the caller's formatter (the Accounts screen's In ¥ / In ₹ toggle)", () => {
  const formatValue = vi.fn((n: number) => `¥${n}`)
  const opts = buildAreaOptions('#efece6', '#2e2c29', formatValue)
  expect(opts.scales!.y!.ticks!.color).toBe('#efece6')
  expect(opts.scales!.x!.ticks!.color).toBe('#efece6')
  expect(opts.scales!.y!.grid!.color).toBe('#2e2c29')
  expect(opts.scales!.y!.ticks!.callback!.call({} as never, 1000, 0, [])).toBe('¥1000')
  const tooltipLabel = (opts.plugins!.tooltip as { callbacks: { label: (ctx: unknown) => string } }).callbacks.label
  expect(tooltipLabel({ parsed: { y: 2000 } })).toBe('¥2000')
})

// Fix round 1: Chart.js's default ~1s draw-in animation raced the screenshot script's 450ms
// settle wait, catching the net worth chart empty or mid-draw. `reducedMotion` (the caller passes
// `window.matchMedia('(prefers-reduced-motion: reduce)').matches`) turns it off outright.
it('disables animation when reducedMotion is set, and leaves it alone otherwise', () => {
  expect(buildAreaOptions('#000', '#000', (n) => `${n}`, true).animation).toBe(false)
  expect(buildAreaOptions('#000', '#000', (n) => `${n}`, false).animation).toBeUndefined()
  expect(buildAreaOptions('#000', '#000', (n) => `${n}`).animation).toBeUndefined()
})
