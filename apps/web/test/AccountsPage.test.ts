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
import AccountsPage from '../src/pages/AccountsPage.vue'

const vuetify = createVuetify()

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const ME = {
  userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
  profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: 2400000 },
}
// Account.id and NetWorthResponse.accounts[].accountId are both z.uuid() — real-looking UUIDs,
// not bare 'a1'/'a2', or the networth fetch's schema parse throws and the query never settles.
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const ID3 = '33333333-3333-4333-8333-333333333333'
const ID4 = '44444444-4444-4444-8444-444444444444'
const ID5 = '55555555-5555-4555-8555-555555555555'
const ID6 = '66666666-6666-4666-8666-666666666666'
const ID7 = '77777777-7777-4777-8777-777777777777'
const account = (id: string, name: string, country: 'JP' | 'IN', type: 'bank' | 'cash' | 'card' | 'fd' | 'investment', opts: Partial<{ isEmergencyFund: boolean; archived: boolean }> = {}) => ({
  id, name, country, currency: country === 'JP' ? ('JPY' as const) : ('INR' as const), type,
  isEmergencyFund: opts.isEmergencyFund ?? false, archived: opts.archived ?? false, hasBalances: true,
})
const ACCOUNTS = [
  account(ID1, 'Japan credit card', 'JP', 'card'),
  account(ID2, 'MUFG savings', 'JP', 'bank'),
  account(ID3, 'Shinsei emergency fund', 'JP', 'bank', { isEmergencyFund: true }),
  account(ID4, 'HDFC savings', 'IN', 'bank'),
  account(ID5, 'Second card', 'JP', 'card'),
  account(ID6, 'Zero change bank', 'JP', 'bank'),
  account(ID7, 'A very long account name that should not be truncated in the dom', 'JP', 'bank'),
]
const NETWORTH = {
  rate: '1.694915', cycle: '2026-10',
  current: { japanJpy: 1240000, indiaPaise: 42000000, combinedJpy: 1949069, changeJpy: 212300, changePct: 17.4 },
  assets: { japanJpy: 1268000, indiaPaise: 42000000 },
  liabilities: { japanJpy: 28000, indiaPaise: 0 },
  series: [{ cycle: '2026-09', combinedJpy: 1216769 }, { cycle: '2026-10', combinedJpy: 1949069 }],
  accounts: [
    { accountId: ID1, amount: 28000, source: 'this' as const, fromCycle: '2026-10', changeAmount: 3000 },
    { accountId: ID2, amount: 1240000, source: 'this' as const, fromCycle: '2026-10', changeAmount: 40000 },
    { accountId: ID3, amount: 2000000, source: 'carried' as const, fromCycle: '2026-09', changeAmount: null },
    { accountId: ID4, amount: null, source: 'none' as const, fromCycle: null, changeAmount: null },
    { accountId: ID5, amount: 5000, source: 'this' as const, fromCycle: '2026-10', changeAmount: -1000 },
    { accountId: ID6, amount: 500000, source: 'this' as const, fromCycle: '2026-10', changeAmount: 0 },
    { accountId: ID7, amount: 100000, source: 'this' as const, fromCycle: '2026-10', changeAmount: 1000 },
  ],
  emergencyFund: { balanceJpy: 2000000, goalJpy: 2400000, monthsCovered: 6.1, avgSpendJpy: 327000 },
}

async function mountAccounts(accountItems: typeof ACCOUNTS) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/accounts')) return jsonResponse({ items: accountItems })
    if (url.startsWith('/api/networth')) return jsonResponse(NETWORTH)
    if (url === '/api/me') return jsonResponse(ME)
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/accounts', component: AccountsPage },
      { path: '/accounts/balances', component: { template: '<div/>' } },
      { path: '/settings', component: { template: '<div/>' } },
    ],
  })
  router.push('/accounts')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(AccountsPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 6; i++) await flushPromises()
  return wrapper
}

describe('AccountsPage', () => {
  it('groups accounts by TYPE_ORDER (Bank before Cards)', async () => {
    const wrapper = await mountAccounts(ACCOUNTS)
    const headings = wrapper.findAll('.grp-hd h3').map((h) => h.text())
    expect(headings).toEqual(['Bank', 'Cards'])
    expect(wrapper.text()).toContain('MUFG savings')
    expect(wrapper.text()).toContain('Shinsei emergency fund')
    wrapper.unmount()
  })

  it('shows "updated Sep 2026" for a carried balance', async () => {
    const wrapper = await mountAccounts(ACCOUNTS)
    expect(wrapper.text()).toContain('updated Sep 2026')
    wrapper.unmount()
  })

  it('shows "owed" on a card row', async () => {
    const wrapper = await mountAccounts(ACCOUNTS)
    expect(wrapper.text()).toContain('owed')
    wrapper.unmount()
  })

  it('gives every row an accessible "More actions for <name>" menu button', async () => {
    const wrapper = await mountAccounts(ACCOUNTS)
    expect(wrapper.find('[aria-label="More actions for MUFG savings"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="More actions for Japan credit card"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the empty state when there are no accounts yet', async () => {
    const wrapper = await mountAccounts([])
    expect(wrapper.text()).toContain('No accounts yet.')
    wrapper.unmount()
  })

  // Fix round 1 (review finding 2): an increase in what's owed on a card is bad, a decrease is
  // good — the opposite of an asset row, where more is good.
  it('inverts the change colour for a card (liability) row: more owed is the error colour, less owed is success', async () => {
    const wrapper = await mountAccounts(ACCOUNTS)
    const rows = wrapper.findAll('.acct')
    const increasedCard = rows.find((r) => r.text().includes('Japan credit card'))!
    expect(increasedCard.find('.text-error').exists()).toBe(true)
    expect(increasedCard.find('.text-success').exists()).toBe(false)
    const paidDownCard = rows.find((r) => r.text().includes('Second card'))!
    expect(paidDownCard.find('.text-success').exists()).toBe(true)
    expect(paidDownCard.find('.text-error').exists()).toBe(false)
    wrapper.unmount()
  })

  // Fix round 1 (review finding 3): a literal "↑ ¥0" claims a direction that didn't happen.
  it('shows "No change" (no arrow, no colour) for a zero change', async () => {
    const wrapper = await mountAccounts(ACCOUNTS)
    const row = wrapper.findAll('.acct').find((r) => r.text().includes('Zero change bank'))!
    expect(row.text()).toContain('No change')
    expect(row.find('.chg').text()).not.toContain('↑')
    expect(row.find('.chg').text()).not.toContain('↓')
    wrapper.unmount()
  })

  // Fix round 1 (review finding 4): the name must render in full in the markup — only CSS
  // (an ellipsis on `.nm-text` alone) may visually clip it — and the tag/badge must not be fused
  // onto the same line/text node as the name.
  it('renders a long account name in full, with its tag on a separate line from the name', async () => {
    const wrapper = await mountAccounts(ACCOUNTS)
    const row = wrapper.findAll('.acct').find((r) => r.text().includes('A very long account name'))!
    expect(row.find('.nm-text').text()).toBe('A very long account name that should not be truncated in the dom')
    expect(row.find('.sub-row .tag').exists()).toBe(true)
    wrapper.unmount()
  })
})
