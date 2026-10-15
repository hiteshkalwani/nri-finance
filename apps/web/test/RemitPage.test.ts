import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

vi.hoisted(() => {
  class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  if (!('visualViewport' in globalThis)) (globalThis as { visualViewport?: unknown }).visualViewport = undefined
})
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))

import { createVuetify } from 'vuetify'
import RemitPage from '../src/pages/RemitPage.vue'

const vuetify = createVuetify()

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const JP_ACC = 'aaaaaaaa-0000-4000-8000-000000000001'
const IN_ACC = 'aaaaaaaa-0000-4000-8000-000000000002'
const R_ID = 'aaaaaaaa-0000-4000-8000-000000000003'
const ITEM = {
  id: R_ID, sentOn: '2026-10-20', jpySent: 60000, inrPaise: 3540000, feeJpy: 600, service: 'wise',
  fromAccountId: JP_ACC, toAccountId: IN_ACC, purpose: 'family', loanId: null, notes: '', rate: '1.694915',
}
const LIST = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24',
  items: [ITEM],
  totals: {
    jpySent: 60000, inrPaise: 3540000, feesJpy: 600, count: 1, avgRate: '1.694915',
    byPurpose: [{ purpose: 'family', jpySent: 60000, inrPaise: 3540000, count: 1 }],
  },
}
const ACCOUNTS = {
  items: [
    { id: JP_ACC, name: 'MUFG savings', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false, archived: false, hasBalances: true },
    { id: IN_ACC, name: 'HDFC savings', country: 'IN', currency: 'INR', type: 'bank', isEmergencyFund: false, archived: false, hasBalances: true },
  ],
}

async function mountRemit(list: unknown = LIST) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('/api/remittances/rates')) return jsonResponse({ planningRate: '1.700000', points: [{ sentOn: '2026-10-20', rate: '1.694915' }] })
    if (url.startsWith('/api/remittances')) return jsonResponse(list)
    if (url === '/api/accounts?include=archived') return jsonResponse(ACCOUNTS)
    if (url === '/api/me') {
      return jsonResponse({
        userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
        profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
      })
    }
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/remit', component: RemitPage },
      { path: '/remit/new', component: { template: '<div/>' } },
      { path: '/remit/:id', component: { template: '<div/>' } },
    ],
  })
  router.push('/remit')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(RemitPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 8; i++) await flushPromises()
  return { wrapper, calls, router }
}

describe('RemitPage totals and transfers', () => {
  it('shows KPI totals, the purpose breakdown, and the transfer row with resolved account names', async () => {
    const { wrapper } = await mountRemit()

    expect(wrapper.text()).toContain('￥60,000')
    expect(wrapper.text()).toContain('₹35,400.00')
    expect(wrapper.text()).toContain('Family')
    expect(wrapper.text()).toContain('MUFG savings → HDFC savings')
    expect(wrapper.text()).toContain('Wise')

    wrapper.unmount()
  })

  it('shows the empty state when the cycle has no transfers', async () => {
    const { wrapper } = await mountRemit({ ...LIST, items: [], totals: { jpySent: 0, inrPaise: 0, feesJpy: 0, count: 0, avgRate: null, byPurpose: [] } })

    expect(wrapper.text()).toContain('No transfers in this cycle yet.')
    expect(wrapper.text()).toContain('Nothing sent yet this cycle.')

    wrapper.unmount()
  })
})

describe('RemitPage purpose filter', () => {
  it('re-fetches with the purpose query param when a filter chip is clicked', async () => {
    const { wrapper, calls, router } = await mountRemit()
    calls.length = 0

    const chip = wrapper.findAll('.v-chip').find((c) => c.text() === 'SIP')!
    await chip.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.purpose).toBe('sip')
    expect(calls.some((u) => u.includes('purpose=sip'))).toBe(true)

    wrapper.unmount()
  })
})
