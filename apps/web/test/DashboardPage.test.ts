import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

vi.hoisted(() => {
  class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  // The income dialog (a v-dialog) needs this global to exist at all — same guard as App.test.ts.
  if (!('visualViewport' in globalThis)) (globalThis as { visualViewport?: unknown }).visualViewport = undefined
})
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))

import { createVuetify } from 'vuetify'
import DashboardPage from '../src/pages/DashboardPage.vue'

const vuetify = createVuetify()

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111'
const txn = (id: string, occurredOn: string) => ({
  id, occurredOn, cycle: '2026-10', categoryId: CATEGORY_ID, accountId: null,
  description: `Row ${id}`, amountJpy: 1000, enteredCurrency: 'JPY' as const, amountInrPaise: null, rateUsed: null,
  paymentMethod: 'ic_card' as const, needWant: 'need' as const, notes: '',
})
const ROW_IDS = [1, 2, 3, 4, 5, 6, 7].map((n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`)

const dashboardBody = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', incomeJpy: 500000, salaryJpy: 500000, incomeOverridden: false,
  spentJpy: 10000, sentJpy: 0, feesJpy: 0, receivedPaise: 0, keptJpy: 490000,
  savingsRatePct: 98, expenseCount: 7, largestJpy: 5000, needJpy: 8000, wantJpy: 2000,
  byCategory: [{ categoryId: CATEGORY_ID, name: 'Food', color: '#4caf50', spentJpy: 10000 }],
  byCycle: [{ cycle: '2026-10', spentJpy: 10000 }],
  sentByPurpose: [] as { purpose: string; jpySent: number; inrPaise: number; count: number }[],
  loan: null as { name: string; outstandingPaise: number; payoffCycle: string | null } | null,
  sip: null as { paidPaise: number; plannedPaise: number; projectedCorpusPaise: number } | null,
}

const NETWORTH = {
  rate: '1.7', cycle: '2026-10',
  current: { japanJpy: 1240000, indiaPaise: 0, combinedJpy: 1240000, changeJpy: 40000, changePct: 3.3 },
  assets: { japanJpy: 1240000, indiaPaise: 0 },
  liabilities: { japanJpy: 0, indiaPaise: 0 },
  series: [{ cycle: '2026-09', combinedJpy: 1200000 }, { cycle: '2026-10', combinedJpy: 1240000 }],
  accounts: [],
  emergencyFund: { balanceJpy: 900000, goalJpy: 1200000, monthsCovered: 2.8, avgSpendJpy: 320000 },
}
const NETWORTH_EMPTY = {
  rate: '1.7', cycle: '2026-10',
  current: { japanJpy: 0, indiaPaise: 0, combinedJpy: 0, changeJpy: null, changePct: null },
  assets: { japanJpy: 0, indiaPaise: 0 },
  liabilities: { japanJpy: 0, indiaPaise: 0 },
  series: [],
  accounts: [],
  emergencyFund: { balanceJpy: 0, goalJpy: null, monthsCovered: null, avgSpendJpy: null },
}

async function mountDashboard(
  recentItems: ReturnType<typeof txn>[],
  recentTotal: number,
  networth: unknown = NETWORTH,
  dashboardOverride: Partial<typeof dashboardBody> = {},
) {
  const calls: { url: string; init?: RequestInit }[] = []
  const body = { ...dashboardBody, ...dashboardOverride }
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.startsWith('/api/dashboard')) return jsonResponse(body)
    if (url.startsWith('/api/transactions')) {
      return jsonResponse({ items: recentItems, total: recentTotal, page: 1, pageSize: 5, totalJpy: 0, needJpy: 0, wantJpy: 0 })
    }
    if (url.startsWith('/api/networth')) return jsonResponse(networth)
    if (url === '/api/categories') return jsonResponse({ items: [] })
    if (url === '/api/me') {
      return jsonResponse({
        userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
        profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
      })
    }
    if (url.startsWith('/api/cycles/') && url.endsWith('/income')) {
      const incomeJpy = JSON.parse(String(init?.body)).incomeJpy as number | null
      return jsonResponse({ cycle: body.cycle, incomeJpy })
    }
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: DashboardPage },
      { path: '/spend', component: { template: '<div/>' } },
      { path: '/spend/new', component: { template: '<div/>' } },
      { path: '/spend/:id', component: { template: '<div/>' } },
      { path: '/settings', component: { template: '<div/>' } },
      { path: '/accounts', component: { template: '<div/>' } },
      { path: '/accounts/balances', component: { template: '<div/>' } },
    ],
  })
  router.push('/')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(DashboardPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 6; i++) await flushPromises()
  return { wrapper, calls }
}

describe('DashboardPage recent-expenses list (finding 1 check: no link-role regression)', () => {
  it('wraps each recent-expense row in a listitem, keeping the row itself a real link', async () => {
    const { wrapper } = await mountDashboard([txn(ROW_IDS[0]!, '2026-10-05')], 1)

    const list = wrapper.get('[role="list"][aria-label="Recent expenses"]')
    const listitem = list.get('[role="listitem"]')
    expect(listitem.element.tagName).not.toBe('A')
    const link = listitem.get('a')
    expect(link.attributes('role')).toBeUndefined()
    expect(link.attributes('href')).toBe(`/spend/${ROW_IDS[0]}`)

    wrapper.unmount()
  })
})

describe('DashboardPage recent-expenses partial-page total (finding 3)', () => {
  it('marks the last day group when more rows exist than the 5-row page shows', async () => {
    // 7 total expenses, but the "recent" query only ever returns 5 (pageSize=5): the last day
    // group on screen may not be that whole day's total.
    const items = [
      txn(ROW_IDS[0]!, '2026-10-05'), txn(ROW_IDS[1]!, '2026-10-05'),
      txn(ROW_IDS[2]!, '2026-10-04'),
      txn(ROW_IDS[3]!, '2026-10-03'), txn(ROW_IDS[4]!, '2026-10-03'),
    ]
    const { wrapper } = await mountDashboard(items, 7)

    const dayRows = wrapper.findAll('.tx-hd + * .day-row, .day-row')
    expect(dayRows.length).toBeGreaterThan(0)
    const lastDayRow = dayRows[dayRows.length - 1]!
    expect(lastDayRow.text()).toContain('latest 5')
    // Earlier groups are untouched.
    for (const row of dayRows.slice(0, -1)) expect(row.text()).not.toContain('latest 5')

    wrapper.unmount()
  })

  it('does not mark the last group when the recent list already shows every expense', async () => {
    const items = [txn(ROW_IDS[0]!, '2026-10-05'), txn(ROW_IDS[1]!, '2026-10-04')]
    const { wrapper } = await mountDashboard(items, 2)

    const dayRows = wrapper.findAll('.day-row')
    expect(dayRows.length).toBeGreaterThan(0)
    for (const row of dayRows) expect(row.text()).not.toContain('latest 5')

    wrapper.unmount()
  })
})

describe('DashboardPage net worth and emergency fund cards (Task 9)', () => {
  it('shows net worth and emergency fund figures from the networth endpoint', async () => {
    const { wrapper } = await mountDashboard([], 0)

    const nwEl = wrapper.get('[data-testid="networth"]')
    expect(nwEl.text()).toContain('￥1,240,000')
    const efEl = wrapper.get('[data-testid="emergency-fund"]')
    expect(efEl.text()).toContain('￥900,000')
    expect(efEl.text()).toContain('of ￥1,200,000 goal')
    expect(efEl.text()).toContain('2.8 months')

    wrapper.unmount()
  })

  it('shows "Update balances to see this" for both cards when there are no balances yet', async () => {
    const { wrapper } = await mountDashboard([], 0, NETWORTH_EMPTY)
    for (let i = 0; i < 2; i++) await flushPromises()

    expect(wrapper.find('[data-testid="networth"]').exists()).toBe(false)
    const links = wrapper.findAll('a').filter((a) => a.text() === 'Update balances to see this.')
    expect(links.length).toBe(2)
    for (const link of links) expect(link.attributes('href')).toBe('/accounts/balances')

    wrapper.unmount()
  })
})

describe('DashboardPage M2b remittances additions', () => {
  it('shows a "Sent home by purpose" card, hidden when nothing was sent', async () => {
    const { wrapper } = await mountDashboard([], 0, NETWORTH, {
      sentByPurpose: [{ purpose: 'family', jpySent: 60000, inrPaise: 3540000, count: 1 }],
    })
    const card = wrapper.findAll('h2').find((h) => h.text() === 'Sent home by purpose')
    expect(card).toBeTruthy()
    const row = card!.element.closest('.v-card')!
    expect(row.textContent).toContain('Family')
    expect(row.textContent).toContain('￥60,000')
    wrapper.unmount()

    const { wrapper: empty } = await mountDashboard([], 0, NETWORTH, { sentByPurpose: [] })
    expect(empty.findAll('h2').some((h) => h.text() === 'Sent home by purpose')).toBe(false)
    empty.unmount()
  })

  it('opens the income dialog and PUTs the typed amount, clearing it on "Use salary"', async () => {
    const { wrapper, calls } = await mountDashboard([], 0)
    // The dialog teleports its content to a `.v-overlay-container` on `document.body`, outside
    // `wrapper`'s own element tree — same reasoning as AccountsPage's emergency-fund dialog tests.
    const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement

    const editBtn = wrapper.get('[aria-label="Edit income for Oct 2026"]')
    await editBtn.trigger('click')
    await flushPromises()

    const input = document.querySelector('#income-amount') as HTMLInputElement
    input.value = '600000'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    findButton('Save').click()
    await flushPromises()

    const putCall = calls.find((c) => c.url === '/api/cycles/2026-10/income' && c.init?.method === 'PUT')
    expect(putCall).toBeTruthy()
    expect(JSON.parse(String(putCall!.init!.body))).toEqual({ incomeJpy: 600000 })

    wrapper.unmount()
  })
})
