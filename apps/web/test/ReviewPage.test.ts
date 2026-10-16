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
import ReviewPage from '../src/pages/ReviewPage.vue'

async function waitUntil(condition: () => boolean, maxTicks = 50) {
  for (let i = 0; i < maxTicks && !condition(); i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const vuetify = createVuetify()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const ME = {
  userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
  profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
}

const REVIEW_OCT = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24',
  summary: { incomeJpy: 500000, spentJpy: 182340, sentJpy: 150000, keptJpy: 337660, savingsRatePct: 50.4, receivedPaise: 8850000 },
  targets: [{ key: 'savings', targetValue: 300000, actualValue: 337660, diff: 37660, met: true }],
  budgets: [{ categoryId: '11111111-1111-4111-8111-111111111111', name: 'Dining out', color: '#f2c24b', budgetJpy: 15000, effectiveFromCycle: '2026-09', spentJpy: 18900, remainingJpy: -3900, pct: 126, state: 'over' }],
  highlights: [
    { tone: 'bad', text: 'Dining out went over budget by ￥3,900 (126%).' },
    { tone: 'good', text: 'Kept ￥337,660 — ￥37,660 above the savings target.' },
  ],
  balancesDone: false,
  nextCycle: '2026-11',
  nextTargetsSet: false,
}
const TARGETS_NOV_EMPTY = { cycle: '2026-11', savingsJpy: null, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null }

type MountOpts = { review?: unknown; nextTargets?: unknown; onPutTargets?: (url: string, body: unknown) => void }

async function mountReview(cycle: string, opts: MountOpts = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/me') return jsonResponse(ME)
    if (url === `/api/review/${cycle}`) return jsonResponse(opts.review ?? REVIEW_OCT)
    if (url === '/api/targets/2026-11' && init?.method === 'PUT') {
      opts.onPutTargets?.(url, JSON.parse(String(init.body)))
      return jsonResponse({ cycle: '2026-11', ...JSON.parse(String(init.body)) })
    }
    if (url === '/api/targets/2026-11') return jsonResponse(opts.nextTargets ?? TARGETS_NOV_EMPTY)
    throw new Error(`unexpected fetch(${url}, ${init?.method ?? 'GET'})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/accounts/balances', component: { template: '<div/>' } },
      { path: '/review', component: ReviewPage },
      { path: '/review/:cycle', component: ReviewPage },
    ],
  })
  router.push(`/review/${cycle}`)
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(ReviewPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  await waitUntil(() => wrapper.text().includes('How the cycle went'))
  return { wrapper, calls, router }
}

describe('ReviewPage step 1 (summary + highlights)', () => {
  it('renders the summary rows and "Worth a look" highlights with a tone word', async () => {
    const { wrapper } = await mountReview('2026-10')

    expect(wrapper.text()).toContain('￥500,000') // income
    expect(wrapper.text()).toContain('￥182,340') // spent
    expect(wrapper.text()).toContain('₹88,500.00 received')
    expect(wrapper.text()).toContain('50.4% savings rate')

    expect(wrapper.text()).toContain('Over budget')
    expect(wrapper.text()).toContain('Dining out went over budget by ￥3,900 (126%).')
    expect(wrapper.text()).toContain('On track')
    expect(wrapper.text()).toContain('Kept ￥337,660 — ￥37,660 above the savings target.')

    wrapper.unmount()
  })
})

describe('ReviewPage step 3 (next cycle targets PUT body)', () => {
  it('PUTs the typed targets for the next cycle, blank -> null', async () => {
    let putBody: unknown = null
    const { wrapper } = await mountReview('2026-10', { onPutTargets: (_u, b) => { putBody = b } })

    await wrapper.findAll('button').find((b) => b.text().includes("Next cycle's targets"))!.trigger('click')
    await flushPromises()

    const inputs = wrapper.findAll('.trow input')
    await inputs[0]!.setValue('350000') // savings
    await inputs[2]!.setValue('150000') // remittance
    await flushPromises()

    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'Save targets')!
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(false)
    await saveBtn.trigger('click')
    await waitUntil(() => putBody !== null)

    expect(putBody).toEqual({ savingsJpy: 350000, emergencyFundJpy: null, remittanceJpy: 150000, prepaymentPaise: null })

    wrapper.unmount()
  })
})
