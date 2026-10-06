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
import UpdateBalancesPage from '../src/pages/UpdateBalancesPage.vue'

// A fixed number of `flushPromises()` calls is racy for anything past the initial load here (it
// drains microtasks only; a mock `fetch`'s Promise resolution can still interleave with real
// macrotask ticks in between, e.g. the save flow's PUT → 3 invalidated queries → redirect chain).
// Polls a real condition with a real macrotask yield between each microtask flush instead.
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
function errorResponse(status: number, details: { path: unknown[]; message: string }[]) {
  return new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Request body is invalid', details } }), {
    status, headers: { 'content-type': 'application/json' },
  })
}

const ME = {
  userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
  profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: 2400000 },
}
const ID1 = '11111111-1111-4111-8111-111111111111' // MUFG savings, JP bank, this cycle
const ID2 = '22222222-2222-4222-8222-222222222222' // Japan credit card, JP card, this cycle
const ID3 = '33333333-3333-4333-8333-333333333333' // Shinsei emergency fund, JP bank, carried from Sep
const ID4 = '44444444-4444-4444-8444-444444444444' // HDFC savings, IN bank, this cycle

const BALANCES_OCT = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', rate: '1.694915',
  rows: [
    { accountId: ID1, name: 'MUFG savings', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false, amount: 1240000, source: 'this', fromCycle: '2026-10' },
    { accountId: ID2, name: 'Japan credit card', country: 'JP', currency: 'JPY', type: 'card', isEmergencyFund: false, amount: 28000, source: 'this', fromCycle: '2026-10' },
    { accountId: ID3, name: 'Shinsei emergency fund', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: true, amount: 2000000, source: 'carried', fromCycle: '2026-09' },
    { accountId: ID4, name: 'HDFC savings', country: 'IN', currency: 'INR', type: 'bank', isEmergencyFund: false, amount: 40670000, source: 'this', fromCycle: '2026-10' },
  ],
}
const NETWORTH_OCT = {
  rate: '1.694915', cycle: '2026-10',
  current: { japanJpy: 3212000, indiaPaise: 40670000, combinedJpy: 1949069, changeJpy: 212300, changePct: 17.4 },
  assets: { japanJpy: 3240000, indiaPaise: 40670000 },
  liabilities: { japanJpy: 28000, indiaPaise: 0 },
  series: [], accounts: [],
  emergencyFund: { balanceJpy: 2000000, goalJpy: 2400000, monthsCovered: 6.1, avgSpendJpy: 327000 },
}
// A second cycle, distinct from both the Oct fixture above and from anything the "cycle switch"
// test types into a field — so a field showing this value unambiguously means "the new cycle
// loaded", not "the edit survived".
const BALANCES_NOV = {
  cycle: '2026-11', start: '2026-10-25', end: '2026-11-24', rate: '1.694915',
  rows: [
    { accountId: ID1, name: 'MUFG savings', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false, amount: 1300000, source: 'this', fromCycle: '2026-11' },
    { accountId: ID2, name: 'Japan credit card', country: 'JP', currency: 'JPY', type: 'card', isEmergencyFund: false, amount: 31000, source: 'this', fromCycle: '2026-11' },
    { accountId: ID3, name: 'Shinsei emergency fund', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: true, amount: 2000000, source: 'this', fromCycle: '2026-11' },
    { accountId: ID4, name: 'HDFC savings', country: 'IN', currency: 'INR', type: 'bank', isEmergencyFund: false, amount: 41000000, source: 'this', fromCycle: '2026-11' },
  ],
}
const NETWORTH_NOV = { ...NETWORTH_OCT, cycle: '2026-11', current: { ...NETWORTH_OCT.current, changeJpy: 50000, changePct: 2.5 } }

type MountOpts = {
  putResponse?: () => Response
  balancesByCycle?: Record<string, unknown>
  networthByCycle?: Record<string, unknown>
  /** Pre-seeds the query cache before mounting — simulates arriving on this page with another
   * cycle's (or this same cycle's, now-stale) data already cached from an earlier visit. */
  seed?: (qc: QueryClient) => void
}

async function mountBalances(opts: MountOpts = {}) {
  const balancesByCycle = opts.balancesByCycle ?? { '2026-10': BALANCES_OCT }
  const networthByCycle = opts.networthByCycle ?? { '2026-10': NETWORTH_OCT }
  const putResponse = opts.putResponse ?? (() => jsonResponse(BALANCES_OCT))

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const cycle = new URL(url, 'http://test').searchParams.get('cycle') ?? '2026-10'
    if (url.startsWith('/api/balances') && method === 'GET') return jsonResponse(balancesByCycle[cycle])
    if (url.startsWith('/api/balances') && method === 'PUT') return putResponse()
    if (url.startsWith('/api/networth')) return jsonResponse(networthByCycle[cycle])
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
  opts.seed?.(queryClient)
  // Mounted behind a real `<router-view />` (not the page directly) — `onBeforeRouteLeave` and
  // `onBeforeRouteUpdate` only register against vue-router's matched-record tracking when the
  // calling component is actually rendered as a router view's matched component, same as it is in
  // the real app's App.vue.
  const wrapper = mount(
    { template: '<router-view />' },
    { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body },
  )
  for (let i = 0; i < 8; i++) await flushPromises()
  return { wrapper, fetchMock, router, queryClient, balancesByCycle }
}

function saveButton(wrapper: Awaited<ReturnType<typeof mountBalances>>['wrapper']) {
  return wrapper.findAll('button').find((b) => b.text().includes('Save balances'))!
}
function findButtonByText(text: string): HTMLButtonElement {
  // Dialog content teleports to a `.v-overlay-container` on `document.body`, outside `wrapper`'s
  // own element tree (same reason the AccountsPage snackbar needed `document.body`) — a plain DOM
  // query sidesteps needing a test-utils wrapper around it.
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement
}

describe('UpdateBalancesPage', () => {
  it('prefills every field, grouped, and hints "from Sep" on the untouched carried row', async () => {
    const { wrapper } = await mountBalances()

    expect((wrapper.get(`#bal-${ID1}`).element as HTMLInputElement).value).toBe('1,240,000')
    expect((wrapper.get(`#bal-${ID3}`).element as HTMLInputElement).value).toBe('2,000,000')
    expect((wrapper.get(`#bal-${ID4}`).element as HTMLInputElement).value).toBe('4,06,700.00')
    expect(wrapper.text()).toContain('from Sep')

    wrapper.unmount()
  })

  it('shows the raw editable text while a field is focused, then re-formats it on blur', async () => {
    const { wrapper } = await mountBalances()
    const field = wrapper.get(`#bal-${ID1}`)
    const input = field.element as HTMLInputElement

    expect(input.value).toBe('1,240,000') // blurred/pristine — grouped

    await field.trigger('focus')
    expect(input.value).toBe('1240000') // focused — raw, as stored

    await field.trigger('blur')
    expect(input.value).toBe('1,240,000') // blurred again — grouped

    wrapper.unmount()
  })

  it('does not mark a field dirty, or send it, just because it was re-typed with different formatting', async () => {
    const { wrapper, fetchMock } = await mountBalances()

    // Same amount as the prefill (¥1,240,000), just with commas added by hand.
    await wrapper.get(`#bal-${ID1}`).setValue('1,240,000')
    await flushPromises()

    // Nothing to save: ID1 is unchanged by value, and the other two "this"-cycle rows (ID2, ID4)
    // were never touched — only the carried row (ID3) would be confirmed, same as a fresh load.
    const button = saveButton(wrapper)
    expect(button.attributes('disabled')).toBeUndefined() // ID3 (carried) alone still allows Save
    await button.trigger('click')
    for (let i = 0; i < 6; i++) await flushPromises()

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const body = JSON.parse(String((putCall![1] as RequestInit).body))
    expect(body.entries).toEqual([{ accountId: ID3, amount: 2000000 }]) // ID1 not sent — unchanged by value

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

  it('shows a "Left blank — keeps …" hint when a field with a value is cleared, and the footer preview does not change', async () => {
    const { wrapper } = await mountBalances()

    expect(wrapper.text()).toContain('￥1,949,069') // baseline "Net worth after saving" before any edit

    await wrapper.get(`#bal-${ID1}`).setValue('')
    await flushPromises()

    expect(wrapper.text()).toContain('Left blank — keeps ￥1,240,000')
    expect(wrapper.text()).toContain('￥1,949,069') // unchanged — blank means "keep the current value"

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

  it('maps a PUT 400 field error (details path [\'entries\', 1, \'amount\']) onto the right field, not the other one', async () => {
    const { wrapper } = await mountBalances({
      putResponse: () => errorResponse(400, [{ path: ['entries', 1, 'amount'], message: 'Amount is too large' }]),
    })

    // Edits ID1 (→ entries[0]) and lets the untouched carried row ID3 ride along (→ entries[1]),
    // same pairing as the "sends only…" test above — the 400 targets index 1, i.e. ID3.
    await wrapper.get(`#bal-${ID1}`).setValue('1250000')
    await flushPromises()
    await saveButton(wrapper).trigger('click')
    await waitUntil(() => wrapper.text().includes('Amount is too large'))

    const rows = wrapper.findAll('.brow')
    const id3Row = rows.find((r) => r.find(`#bal-${ID3}`).exists())!
    const id1Row = rows.find((r) => r.find(`#bal-${ID1}`).exists())!
    expect(id3Row.text()).toContain('Amount is too large')
    expect(id1Row.text()).not.toContain('Amount is too large')

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

    findButtonByText('Discard changes').click()
    await navigated
    await waitUntil(() => router.currentRoute.value.path === '/accounts')

    expect(router.currentRoute.value.path).toBe('/accounts')

    wrapper.unmount()
  })

  it('navigates to /accounts after a successful save', async () => {
    const { wrapper, router } = await mountBalances()

    await wrapper.get(`#bal-${ID1}`).setValue('1250000')
    await flushPromises()
    await saveButton(wrapper).trigger('click')
    await waitUntil(() => router.currentRoute.value.path === '/accounts')

    expect(router.currentRoute.value.path).toBe('/accounts')

    wrapper.unmount()
  })

  // Fix round 1 (coordinator finding 1): switching cycles via the ‹ › picker is a same-route query
  // change (`onBeforeRouteUpdate`, not `onBeforeRouteLeave`) — it used to bypass the unsaved-
  // changes guard entirely and silently rebuild `fields` for the new cycle.
  it('warns before switching cycles with unsaved changes, keeps the field until confirmed, then loads the new cycle', async () => {
    const { wrapper, router } = await mountBalances({
      balancesByCycle: { '2026-10': BALANCES_OCT, '2026-11': BALANCES_NOV },
      networthByCycle: { '2026-10': NETWORTH_OCT, '2026-11': NETWORTH_NOV },
    })

    await wrapper.get(`#bal-${ID1}`).setValue('1250000')
    await flushPromises()

    await wrapper.get('[aria-label="Next cycle"]').trigger('click')
    await waitUntil(() => document.body.textContent?.includes('Discard unsaved changes?') ?? false)

    // Still on Oct — blocked — and the edited value is kept, not discarded by the cycle watch.
    expect(router.currentRoute.value.query.cycle).not.toBe('2026-11')
    expect(document.body.textContent).toContain('Discard unsaved changes?')
    expect((wrapper.get(`#bal-${ID1}`).element as HTMLInputElement).value).toBe('1,250,000')

    findButtonByText('Discard changes').click()
    await waitUntil(() => (wrapper.get(`#bal-${ID1}`).element as HTMLInputElement).value === '1,300,000')

    expect(router.currentRoute.value.query.cycle).toBe('2026-11')

    wrapper.unmount()
  })

  // Final whole-branch review finding 1 (Critical): the old `fields` watch was keyed only on
  // `b.value?.cycle` — on remount, vue-query serves a cached `['balances', cycle]` response
  // immediately, and once the background refetch resolves *for that same cycle*, the cycle string
  // never changes, so `fields` was never rebuilt from the fresh data at all. A stale prefilled
  // value could then be confirmed and saved as the cycle's own snapshot.
  it('rebuilds fields from the fresh refetch, not the stale cache a remount serves first, and Save sends the fresh carried amount', async () => {
    const STALE = { ...BALANCES_OCT, rows: BALANCES_OCT.rows.map((r) => (r.accountId === ID1 ? { ...r, amount: 1000000 } : r)) }
    const FRESH = BALANCES_OCT // the "real" server response: ID1 is ¥1,240,000, not the stale ¥1,000,000

    const { wrapper, fetchMock } = await mountBalances({
      balancesByCycle: { '2026-10': FRESH },
      seed: (qc) => qc.setQueryData(['balances', ''], STALE),
    })

    // The field shows the fresh value once the refetch resolves, not the stale cached one.
    expect((wrapper.get(`#bal-${ID1}`).element as HTMLInputElement).value).toBe('1,240,000')

    const button = saveButton(wrapper)
    await button.trigger('click')
    for (let i = 0; i < 6; i++) await flushPromises()

    // Only the untouched carried row (ID3) is confirmed — it's sent at its *fresh* amount, never
    // anything derived from the stale cache.
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const body = JSON.parse(String((putCall![1] as RequestInit).body))
    expect(body.entries).toEqual([{ accountId: ID3, amount: 2000000 }])

    wrapper.unmount()
  })

  // Final whole-branch review finding 1 (Critical), continued: the same stale-watch bug meant that
  // once an account was added or unarchived elsewhere (AccountDialog/AccountsPage now also
  // invalidate `['balances']`), the resulting fresh GET's extra row had no matching field at all —
  // `fieldFor(row)` returned `undefined`, and the template's `undefined!.text` threw. This must
  // instead add a field for the new row (and keep whichever fields the user had already edited).
  it('adds a field for a new row from a fresh refetch without throwing, and keeps an in-progress edit on another field', async () => {
    const { wrapper, queryClient, balancesByCycle } = await mountBalances()

    await wrapper.get(`#bal-${ID1}`).setValue('1250000') // an in-progress, unsaved edit
    await flushPromises()

    const NEW_ID = '55555555-5555-4555-8555-555555555555'
    balancesByCycle['2026-10'] = {
      ...BALANCES_OCT,
      rows: [
        ...BALANCES_OCT.rows,
        { accountId: NEW_ID, name: 'New JP bank', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false, amount: 500, source: 'this', fromCycle: '2026-10' },
      ],
    }
    await queryClient.invalidateQueries({ queryKey: ['balances'] })
    await waitUntil(() => wrapper.text().includes('New JP bank'))

    expect(wrapper.find(`#bal-${NEW_ID}`).exists()).toBe(true) // renders the new row instead of throwing
    expect((wrapper.get(`#bal-${ID1}`).element as HTMLInputElement).value).toBe('1,250,000') // edit kept

    wrapper.unmount()
  })
})
