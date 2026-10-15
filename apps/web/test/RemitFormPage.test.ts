import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

vi.hoisted(() => {
  class FakeIntersectionObserver {
    #cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) { this.#cb = cb }
    observe(target: Element) {
      queueMicrotask(() => this.#cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver
  class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  if (!('visualViewport' in globalThis)) (globalThis as { visualViewport?: unknown }).visualViewport = undefined
})
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))

import { createVuetify } from 'vuetify'
import RemitFormPage from '../src/pages/RemitFormPage.vue'
import { undo } from '../src/lib/undo'

const vuetify = createVuetify()

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const PROFILE = {
  userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
  profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
}
const JP_ACC = 'aaaaaaaa-0000-4000-8000-000000000001'
const IN_ACC = 'aaaaaaaa-0000-4000-8000-000000000002'
const R_ID = 'aaaaaaaa-0000-4000-8000-000000000003'
const L1 = 'aaaaaaaa-0000-4000-8000-000000000004'
const L2 = 'aaaaaaaa-0000-4000-8000-000000000005'
const ACCOUNTS = {
  items: [
    { id: JP_ACC, name: 'MUFG savings', country: 'JP', currency: 'JPY', type: 'bank', isEmergencyFund: false, archived: false, hasBalances: true },
    { id: IN_ACC, name: 'HDFC savings', country: 'IN', currency: 'INR', type: 'bank', isEmergencyFund: false, archived: false, hasBalances: true },
  ],
}
const REMITTANCE = {
  id: R_ID, sentOn: '2026-10-20', jpySent: 60000, inrPaise: 3540000, feeJpy: 600, service: 'wise',
  fromAccountId: JP_ACC, toAccountId: IN_ACC, purpose: 'family', loanId: null, notes: 'rent', rate: '1.694915',
}

type Loan = { id: string; name: string; closedAt: string | null }

async function mountForm(opts: { path: string; loans?: Loan[] }) {
  const loans = opts.loans ?? []
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/me') return jsonResponse(PROFILE)
    if (url === '/api/accounts?include=archived') return jsonResponse(ACCOUNTS)
    if (url === '/api/loans') return jsonResponse(loans)
    if (url === '/api/remittances' && init?.method === 'POST') return jsonResponse({ ...REMITTANCE, ...JSON.parse(String(init.body)) }, 201)
    if (url.startsWith('/api/remittances/') && init?.method === 'PATCH') return jsonResponse({ ...REMITTANCE, ...JSON.parse(String(init.body)) })
    if (url.startsWith('/api/remittances/') && init?.method === 'DELETE') return jsonResponse(null, 204)
    if (url.startsWith('/api/remittances/')) return jsonResponse(REMITTANCE)
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/remit/new', component: RemitFormPage },
      { path: '/remit', component: { template: '<div/>' } },
      { path: '/remit/:id', component: RemitFormPage },
    ],
  })
  router.push(opts.path)
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(RemitFormPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 8; i++) await flushPromises()
  return { wrapper, calls, router }
}

afterEach(() => {
  undo.pendingRemittance.value = null
})

describe('RemitFormPage live rate panel', () => {
  it('shows the effective rate and a "better/worse" vs-plan word as amounts are typed', async () => {
    const { wrapper } = await mountForm({ path: '/remit/new' })

    await wrapper.get('#jpySent').setValue('160000')
    await wrapper.get('#inrPaise').setValue('100000.00')
    await flushPromises()

    const panel = wrapper.get('.rate-panel')
    expect(panel.text()).toContain('¥1.6000 per ₹1')
    expect(panel.text()).toContain('better')

    wrapper.unmount()
  })
})

describe('RemitFormPage loan picker', () => {
  it('auto-picks the single open loan and shows it as text', async () => {
    const { wrapper } = await mountForm({ path: '/remit/new', loans: [{ id: L1, name: 'SBI home loan', closedAt: null }] })
    const emiChip = wrapper.findAll('.v-chip').find((c) => c.text().includes('Loan EMI'))!
    await emiChip.trigger('click')
    await flushPromises()

    expect(wrapper.get('.loan-auto').text()).toContain('SBI home loan')
    expect(wrapper.findAll('label').some((l) => l.text() === 'Loan')).toBe(false)

    wrapper.unmount()
  })

  it('offers a real select when more than one loan is open', async () => {
    const { wrapper } = await mountForm({
      path: '/remit/new',
      loans: [{ id: L1, name: 'SBI home loan', closedAt: null }, { id: L2, name: 'HDFC personal loan', closedAt: null }],
    })
    const emiChip = wrapper.findAll('.v-chip').find((c) => c.text().includes('Loan EMI'))!
    await emiChip.trigger('click')
    await flushPromises()

    expect(wrapper.find('.loan-auto').exists()).toBe(false)
    expect(wrapper.findAll('label').some((l) => l.text() === 'Loan')).toBe(true)

    wrapper.unmount()
  })

  it('disables the loan-linked purpose chips with "No loan yet" when there is no open loan', async () => {
    const { wrapper } = await mountForm({ path: '/remit/new', loans: [] })
    const emiChip = wrapper.findAll('.v-chip').find((c) => c.text().includes('Loan EMI'))!

    expect(emiChip.text()).toContain('No loan yet')
    expect(emiChip.classes()).toContain('v-chip--disabled')

    wrapper.unmount()
  })

  it('blocks Save with a field error when a loan-linked purpose has no loan chosen', async () => {
    const { wrapper, calls } = await mountForm({
      path: '/remit/new',
      loans: [{ id: L1, name: 'SBI home loan', closedAt: null }, { id: L2, name: 'HDFC personal loan', closedAt: null }],
    })
    await wrapper.get('#jpySent').setValue('60000')
    await wrapper.get('#inrPaise').setValue('35400')
    const emiChip = wrapper.findAll('.v-chip').find((c) => c.text().includes('Loan EMI'))!
    await emiChip.trigger('click')
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Choose a loan')
    expect(calls.some((c) => c.url === '/api/remittances' && c.init?.method === 'POST')).toBe(false)

    wrapper.unmount()
  })
})

describe('RemitFormPage delete + undo', () => {
  it('deletes the transfer and stashes its values verbatim for undo', async () => {
    const { wrapper, calls } = await mountForm({ path: `/remit/${R_ID}` })

    const deleteBtn = wrapper.findAll('button').find((b) => b.text() === 'Delete')!
    await deleteBtn.trigger('click')
    await flushPromises()

    expect(calls.some((c) => c.url === `/api/remittances/${R_ID}` && c.init?.method === 'DELETE')).toBe(true)
    expect(undo.pendingRemittance.value).toEqual({
      sentOn: '2026-10-20', jpySent: 60000, inrPaise: 3540000, feeJpy: 600, service: 'wise',
      fromAccountId: JP_ACC, toAccountId: IN_ACC, purpose: 'family', loanId: null, notes: 'rent',
    })

    wrapper.unmount()
  })
})
