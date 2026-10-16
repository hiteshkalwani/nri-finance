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
vi.mock('@nri/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nri/core')>()
  return { ...actual, todayIn: () => '2026-10-16' }
})

import { createVuetify } from 'vuetify'
import SipPage from '../src/pages/SipPage.vue'

const vuetify = createVuetify()

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const ME = {
  userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
  profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
}
const PLAN = {
  startingMonthlyPaise: 1200000, stepUpPct: '10', expectedReturnPct: '12', startYear: 2026, endYear: 2036,
  redirectEmiAfterPayoff: true,
  allocations: [
    { fundName: 'Nifty 50 index fund', pct: '40' }, { fundName: 'Flexi cap fund', pct: '30' },
    { fundName: 'Mid cap fund', pct: '20' }, { fundName: 'Short-term debt fund', pct: '10' },
  ],
}
const PROJECTION = {
  plan: PLAN,
  years: [
    { year: 2026, monthlyPaise: 1200000, sipPaidPaise: 14400000, emiPaidPaise: 0, sipCorpusPaise: 14800000, emiCorpusPaise: 0 },
    { year: 2036, monthlyPaise: 3100000, sipPaidPaise: 37200000, emiPaidPaise: 33600000, sipCorpusPaise: 500000000, emiCorpusPaise: 100000000 },
  ],
  redirectFromCycle: '2034-04',
  actuals: [{ cycle: '2026-10', paidPaise: 1180000, plannedPaise: 1200000 }],
}

async function mountSip(plan: unknown = PLAN, projection: unknown = PROJECTION) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/sip/projection') return jsonResponse(projection)
    if (url === '/api/sip') return jsonResponse(plan)
    if (url === '/api/me') return jsonResponse(ME)
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/sip', component: SipPage }] })
  router.push('/sip')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(SipPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 8; i++) await flushPromises()
  return { wrapper, calls }
}

describe('SipPage KPIs', () => {
  it('shows paid vs plan this cycle (short), monthly plan, expected return, and projected corpus', async () => {
    const { wrapper } = await mountSip()

    expect(wrapper.text()).toContain('₹11,800.00')
    expect(wrapper.text()).toContain('plan ₹12,000.00')
    expect(wrapper.text()).toContain('₹200.00 short')
    expect(wrapper.text()).toContain('+10% step-up each year')
    expect(wrapper.text()).toContain('12% p.a.')
    expect(wrapper.text()).toContain('redirect EMI after payoff: on')
    expect(wrapper.text()).toContain('₹60,00,000.00')
    expect(wrapper.text()).toContain('incl. EMI redirected from Apr 2034')

    wrapper.unmount()
  })
})

describe('SipPage "Edit plan" dialog', () => {
  it('disables Save unless the allocation total is exactly 100%, and PUTs the typed plan', async () => {
    const { wrapper, calls } = await mountSip()

    await wrapper.findAll('button').find((b) => b.text() === 'Edit plan')!.trigger('click')
    await flushPromises()

    const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement
    // Each `.prow` holds two inputs (fund name, then %) — the plan's own 40/30/20/10 already totals 100.
    const allocPctInputs = Array.from(document.querySelectorAll('.v-dialog .prow input')).filter((_, i) => i % 2 === 1) as HTMLInputElement[]

    expect(findButton('Save').disabled).toBe(false)

    // Break the total (40 → 50) and check Save disables.
    allocPctInputs[0]!.value = '50'
    allocPctInputs[0]!.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(document.querySelector('.v-dialog .total')?.textContent).toContain('110')
    expect(findButton('Save').disabled).toBe(true)

    // Fix it back to 100 and save.
    allocPctInputs[0]!.value = '40'
    allocPctInputs[0]!.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(findButton('Save').disabled).toBe(false)
    findButton('Save').click()
    await flushPromises()

    const putCall = calls.find((c) => c.url === '/api/sip' && c.init?.method === 'PUT')
    expect(putCall).toBeTruthy()
    const body = JSON.parse(String(putCall!.init!.body))
    expect(body.allocations).toEqual(PLAN.allocations)
    expect(body.startingMonthlyPaise).toBe(PLAN.startingMonthlyPaise)

    wrapper.unmount()
  })
})

describe('SipPage empty state', () => {
  it('shows "Set up plan" instead of KPIs when there is no plan yet', async () => {
    const { wrapper } = await mountSip(null, null)

    expect(wrapper.text()).toContain('No SIP plan yet')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Set up plan')).toBe(true)
    expect(wrapper.text()).not.toContain('Paid this cycle')

    wrapper.unmount()
  })
})
