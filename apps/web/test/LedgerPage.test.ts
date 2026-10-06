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
import LedgerPage from '../src/pages/LedgerPage.vue'

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

async function mountLedger(items: ReturnType<typeof txn>[], total = items.length) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/transactions')) {
      return jsonResponse({ items, total, page: 1, pageSize: 50, totalJpy: 0, needJpy: 0, wantJpy: 0 })
    }
    if (url === '/api/categories') return jsonResponse({ items: [] })
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
      { path: '/spend', component: LedgerPage },
      { path: '/spend/new', component: { template: '<div/>' } },
      { path: '/spend/:id', component: { template: '<div/>' } },
    ],
  })
  router.push('/spend')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(LedgerPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 6; i++) await flushPromises()
  return wrapper
}

describe('LedgerPage row roles (finding 1: a link must keep role="link", not be overwritten to "listitem")', () => {
  it('wraps each expense row in a listitem, keeping the row itself a real link', async () => {
    const wrapper = await mountLedger([txn('aaaaaaaa-0000-4000-8000-000000000001', '2026-10-05')])

    const list = wrapper.get('[role="list"]')
    const listitem = list.get('[role="listitem"]')
    // The listitem wrapper must not itself be the anchor...
    expect(listitem.element.tagName).not.toBe('A')
    // ...and the anchor inside it must be a real, unadorned link (no role override hiding its
    // native link semantics from assistive tech).
    const link = listitem.get('a')
    expect(link.attributes('role')).toBeUndefined()
    expect(link.attributes('href')).toBe('/spend/aaaaaaaa-0000-4000-8000-000000000001')

    wrapper.unmount()
  })
})
