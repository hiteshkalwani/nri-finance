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
// Pins "today" so the Upcoming/Past schedule filter and the KPI payoff text are deterministic,
// regardless of when this suite actually runs — everything else from @nri/core (amortize, the
// loan used to build the original-plan line) stays real.
vi.mock('@nri/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nri/core')>()
  return { ...actual, todayIn: () => '2026-10-16' }
})

import { createVuetify } from 'vuetify'
import LoanPage from '../src/pages/LoanPage.vue'

const vuetify = createVuetify()

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const LOAN_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const LOAN_DETAIL = {
  id: LOAN_ID, name: 'SBI home loan', principalPaise: 320000000, annualRatePct: '8.500',
  emiPaise: 2800000, tenureMonths: 180, startCycle: '2026-08', closedAt: null,
}
const ROWS = [
  { month: 1, cycle: '2026-08', openingPaise: 320000000, interestPaise: 2266667, emiPaise: 2800000, extraPaise: 0, closingPaise: 319466667, actual: true },
  { month: 2, cycle: '2026-09', openingPaise: 319466667, interestPaise: 2263056, emiPaise: 2800000, extraPaise: 0, closingPaise: 318929723, actual: false },
  { month: 3, cycle: '2026-10', openingPaise: 318929723, interestPaise: 2259254, emiPaise: 2800000, extraPaise: 0, closingPaise: 318388977, actual: false },
  { month: 4, cycle: '2026-11', openingPaise: 318388977, interestPaise: 2255256, emiPaise: 2800000, extraPaise: 20000000, closingPaise: 297844233, actual: false },
]
const SCHEDULE = {
  loan: LOAN_DETAIL, rows: ROWS,
  plan: { payoffCycle: '2041-10', months: 180, totalInterestPaise: 50_00_00_00_000 },
  projected: { payoffCycle: '2034-03', months: 91, totalInterestPaise: 40_00_00_00_000 },
  interestSavedPaise: 10_00_00_00_000,
  outstandingPaise: 318929723,
}
const ME = {
  userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
  profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
}

async function mountLoan(path = `/loans/${LOAN_ID}`) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/loans') return jsonResponse([{ id: LOAN_ID, name: 'SBI home loan', closedAt: null }])
    if (url === `/api/loans/${LOAN_ID}/schedule`) return jsonResponse(SCHEDULE)
    if (url === `/api/loans/${LOAN_ID}/planned-prepayments`) return new Response(null, { status: 204 })
    if (url === '/api/me') return jsonResponse(ME)
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/loans', component: LoanPage }, { path: '/loans/:id', component: LoanPage }],
  })
  router.push(path)
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(LoanPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 8; i++) await flushPromises()
  return { wrapper, calls, router }
}

describe('LoanPage KPIs', () => {
  it('shows outstanding, EMI, interest saved, and the earlier-than-plan payoff text', async () => {
    const { wrapper } = await mountLoan()

    expect(wrapper.text()).toContain('₹31,89,297.23')
    expect(wrapper.text()).toContain('₹28,000.00')
    expect(wrapper.text()).toContain('₹10,00,00,000.00')
    expect(wrapper.text()).toContain('Mar 2034')
    expect(wrapper.text()).toContain('7 yrs 7 mo earlier than plan (Oct 2041)')

    wrapper.unmount()
  })
})

describe('LoanPage schedule filter', () => {
  it('defaults to Upcoming (current cycle and later), and switches with Past/All', async () => {
    const { wrapper } = await mountLoan()

    const findButton = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
    // Scoped to the Schedule table itself, not the balance chart's own a11y list above it (which
    // legitimately lists every year's cycle, including Aug 2026).
    const tableText = () => wrapper.get('[aria-label="Loan schedule"]').text()

    // Upcoming (default): 2026-10 (current) and 2026-11, not the past 2026-08/09 rows.
    expect(tableText()).not.toContain('Aug 2026')
    expect(tableText()).toContain('Oct 2026')
    expect(tableText()).toContain('Nov 2026')

    await findButton('Past').trigger('click')
    expect(tableText()).toContain('Aug 2026')
    expect(tableText()).toContain('Sep 2026')
    expect(tableText()).not.toContain('Nov 2026')
    // The actual badge only ever shows on the real (actual=true) row.
    expect(tableText()).toContain('actual')

    await findButton('All').trigger('click')
    expect(tableText()).toContain('Aug 2026')
    expect(tableText()).toContain('Nov 2026')

    wrapper.unmount()
  })
})

describe('LoanPage "Plan a prepayment" dialog', () => {
  it('prefills from the schedule\'s own planned extras and PUTs cycle→monthIndex correctly', async () => {
    const { wrapper, calls } = await mountLoan()

    await wrapper.findAll('button').find((b) => b.text() === 'Plan a prepayment')!.trigger('click')
    await flushPromises()

    // Prefilled from the one non-actual row carrying a planned extra (2026-11, month 4).
    const inputs = Array.from(document.querySelectorAll('input')).filter((i) => i.closest('.v-dialog'))
    const monthInput = inputs.find((i) => i.getAttribute('type') === 'month') as HTMLInputElement
    expect(monthInput.value).toBe('2026-11')

    const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement
    findButton('Save').click()
    await flushPromises()

    const putCall = calls.find((c) => c.url === `/api/loans/${LOAN_ID}/planned-prepayments` && c.init?.method === 'PUT')
    expect(putCall).toBeTruthy()
    expect(JSON.parse(String(putCall!.init!.body))).toEqual({ items: [{ monthIndex: 4, amountPaise: 20000000 }] })

    wrapper.unmount()
  })
})
