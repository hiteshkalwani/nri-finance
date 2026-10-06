import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

vi.hoisted(() => {
  class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  // jsdom has no `visualViewport` global at all — the bare identifier Vuetify's VOverlay location
  // strategy reads (`visualViewport?.addEventListener`) throws a ReferenceError before optional
  // chaining can short-circuit it, once a test actually opens an overlay (here, the leave-confirm
  // dialog). Same fix as AccountsPage.test.ts.
  if (!('visualViewport' in globalThis)) (globalThis as { visualViewport?: unknown }).visualViewport = undefined
})
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))

import { createVuetify } from 'vuetify'
import type { Router } from 'vue-router'
import UpdateBalancesPage from '../src/pages/UpdateBalancesPage.vue'

// The post-save redirect sits behind an unusually deep await chain (PUT, then 3 invalidated
// queries each refetching over the network, *then* the route change) — a fixed number of
// `flushPromises()` calls is racy for it (it drains microtasks only; a mock `fetch`'s Promise
// resolution can still interleave with real macrotask ticks in between). Polls with a real
// macrotask yield between each microtask flush instead of guessing a "big enough" fixed count.
async function waitForPath(router: Router, path: string, maxTicks = 50) {
  for (let i = 0; i < maxTicks && router.currentRoute.value.path !== path; i++) {
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
  profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: 2400000 },
}
const ID1 = '11111111-1111-4111-8111-111111111111' // MUFG savings, JP bank, this cycle
const ID2 = '22222222-2222-4222-8222-222222222222' // Japan credit card, JP card, this cycle
const ID3 = '33333333-3333-4333-8333-333333333333' // Shinsei emergency fund, JP bank, carried from Sep
const ID4 = '44444444-4444-4444-8444-444444444444' // HDFC savings, IN bank, this cycle

const BALANCES = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', rate: '1.694915',
  rows: [
    { accountId: ID1, name: 'MUFG savings', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false, amount: 1240000, source: 'this', fromCycle: '2026-10' },
    { accountId: ID2, name: 'Japan credit card', country: 'JP', currency: 'JPY', type: 'card', isEmergencyFund: false, amount: 28000, source: 'this', fromCycle: '2026-10' },
    { accountId: ID3, name: 'Shinsei emergency fund', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: true, amount: 2000000, source: 'carried', fromCycle: '2026-09' },
    { accountId: ID4, name: 'HDFC savings', country: 'IN', currency: 'INR', type: 'bank', isEmergencyFund: false, amount: 40670000, source: 'this', fromCycle: '2026-10' },
  ],
}
const NETWORTH = {
  rate: '1.694915', cycle: '2026-10',
  current: { japanJpy: 3212000, indiaPaise: 40670000, combinedJpy: 1949069, changeJpy: 212300, changePct: 17.4 },
  assets: { japanJpy: 3240000, indiaPaise: 40670000 },
  liabilities: { japanJpy: 28000, indiaPaise: 0 },
  series: [], accounts: [],
  emergencyFund: { balanceJpy: 2000000, goalJpy: 2400000, monthsCovered: 6.1, avgSpendJpy: 327000 },
}

async function mountBalances() {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/balances') && method === 'GET') return jsonResponse(BALANCES)
    if (url.startsWith('/api/balances') && method === 'PUT') return jsonResponse(BALANCES)
    if (url.startsWith('/api/networth')) return jsonResponse(NETWORTH)
    if (url === '/api/me') return jsonResponse(ME)
    throw new Error(`unexpected fetch(${url} ${method})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/accounts/balances', component: UpdateBalancesPage },
      { path: '/accounts', component: { template: '<div/>' } },
    ],
  })
  router.push('/accounts/balances')
  await router.isReady()
  const queryClient = new QueryClient()
  // Mounted behind a real `<router-view />` (not the page directly) — `onBeforeRouteLeave` only
  // registers against vue-router's matched-record tracking when the calling component is actually
  // rendered as a router view's matched component, same as it is in the real app's App.vue.
  const wrapper = mount(
    { template: '<router-view />' },
    { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body },
  )
  for (let i = 0; i < 8; i++) await flushPromises()
  return { wrapper, fetchMock, router }
}

function saveButton(wrapper: Awaited<ReturnType<typeof mountBalances>>['wrapper']) {
  return wrapper.findAll('button').find((b) => b.text().includes('Save balances'))!
}

describe('UpdateBalancesPage', () => {
  it('prefills every field from the GET response and hints "from Sep" on the untouched carried row', async () => {
    const { wrapper } = await mountBalances()

    expect((wrapper.get(`#bal-${ID1}`).element as HTMLInputElement).value).toBe('1240000')
    expect((wrapper.get(`#bal-${ID3}`).element as HTMLInputElement).value).toBe('2000000')
    expect((wrapper.get(`#bal-${ID4}`).element as HTMLInputElement).value).toBe('406700.00')
    expect(wrapper.text()).toContain('from Sep')

    wrapper.unmount()
  })

  it('blocks Save and shows a field error on an invalid ₹ entry (more than 2 decimals)', async () => {
    const { wrapper } = await mountBalances()

    await wrapper.get(`#bal-${ID4}`).setValue('12345.678')
    await flushPromises()

    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Enter an amount with up to 2 decimals')

    wrapper.unmount()
  })

  it('sends only the changed row and the untouched carried row (confirming it), skipping the untouched "this"-cycle rows', async () => {
    const { wrapper, fetchMock } = await mountBalances()

    await wrapper.get(`#bal-${ID1}`).setValue('1250000')
    await flushPromises()

    const button = saveButton(wrapper)
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    for (let i = 0; i < 6; i++) await flushPromises()

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCall).toBeDefined()
    const body = JSON.parse(String((putCall![1] as RequestInit).body))
    expect(body.cycle).toBe('2026-10')
    expect(body.entries).toEqual([
      { accountId: ID1, amount: 1250000 },
      { accountId: ID3, amount: 2000000 },
    ])

    wrapper.unmount()
  })

  it('asks to confirm before leaving with unsaved changes, and only navigates once the user discards them', async () => {
    const { wrapper, router } = await mountBalances()

    await wrapper.get(`#bal-${ID1}`).setValue('1250000')
    await flushPromises()

    const navigated = router.push('/accounts')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/accounts/balances') // still blocked, dialog pending
    expect(document.body.textContent).toContain('Discard unsaved changes?')

    // The dialog teleports its content to a `.v-overlay-container` on `document.body`, outside
    // `wrapper`'s own element tree (same reason the snackbar needed `document.body` above) — a
    // plain DOM click sidesteps needing a test-utils wrapper around it.
    const discard = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Discard changes'))!
    discard.click()
    await navigated
    await waitForPath(router, '/accounts')

    expect(router.currentRoute.value.path).toBe('/accounts')

    wrapper.unmount()
  })

  it('navigates to /accounts after a successful save', async () => {
    const { wrapper, router } = await mountBalances()

    await wrapper.get(`#bal-${ID1}`).setValue('1250000')
    await flushPromises()
    await saveButton(wrapper).trigger('click')
    await waitForPath(router, '/accounts')

    expect(router.currentRoute.value.path).toBe('/accounts')

    wrapper.unmount()
  })
})
