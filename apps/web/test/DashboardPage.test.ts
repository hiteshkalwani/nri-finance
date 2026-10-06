import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

vi.hoisted(() => {
  class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
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
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', incomeJpy: 500000, spentJpy: 10000, sentJpy: 0, feesJpy: 0, keptJpy: 490000,
  savingsRatePct: 98, expenseCount: 7, largestJpy: 5000, needJpy: 8000, wantJpy: 2000,
  byCategory: [{ categoryId: CATEGORY_ID, name: 'Food', color: '#4caf50', spentJpy: 10000 }],
  byCycle: [{ cycle: '2026-10', spentJpy: 10000 }],
}

async function mountDashboard(recentItems: ReturnType<typeof txn>[], recentTotal: number) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/dashboard')) return jsonResponse(dashboardBody)
    if (url.startsWith('/api/transactions')) {
      return jsonResponse({ items: recentItems, total: recentTotal, page: 1, pageSize: 5, totalJpy: 0, needJpy: 0, wantJpy: 0 })
    }
    if (url === '/api/categories') return jsonResponse({ items: [] })
    if (url === '/api/me') {
      return jsonResponse({
        userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
        profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' },
      })
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
    ],
  })
  router.push('/')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(DashboardPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 6; i++) await flushPromises()
  return wrapper
}

describe('DashboardPage recent-expenses list (finding 1 check: no link-role regression)', () => {
  it('wraps each recent-expense row in a listitem, keeping the row itself a real link', async () => {
    const wrapper = await mountDashboard([txn(ROW_IDS[0]!, '2026-10-05')], 1)

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
    const wrapper = await mountDashboard(items, 7)

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
    const wrapper = await mountDashboard(items, 2)

    const dayRows = wrapper.findAll('.day-row')
    expect(dayRows.length).toBeGreaterThan(0)
    for (const row of dayRows) expect(row.text()).not.toContain('latest 5')

    wrapper.unmount()
  })
})
