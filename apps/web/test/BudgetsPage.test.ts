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
import BudgetsPage from '../src/pages/BudgetsPage.vue'

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
const CAT_OVER = '11111111-1111-4111-8111-111111111111'
const CAT_NONE = '22222222-2222-4222-8222-222222222222'

const BUDGETS_OCT = {
  cycle: '2026-10',
  rows: [
    { categoryId: CAT_OVER, name: 'Dining out', color: '#f2c24b', budgetJpy: 15000, effectiveFromCycle: '2026-09', spentJpy: 18900, remainingJpy: -3900, pct: 126, state: 'over' },
    { categoryId: CAT_NONE, name: 'Groceries', color: '#4caf50', budgetJpy: null, effectiveFromCycle: null, spentJpy: 32400, remainingJpy: null, pct: null, state: null },
  ],
}
const TARGETS_OCT = { cycle: '2026-10', savingsJpy: 300000, emergencyFundJpy: null, remittanceJpy: 150000, prepaymentPaise: null }
const DASHBOARD_OCT = {
  cycle: '2026-10', start: '2026-09-25', end: '2026-10-24', incomeJpy: 500000, salaryJpy: 500000, incomeOverridden: false,
  spentJpy: 51300, sentJpy: 150000, feesJpy: 0, receivedPaise: 8850000, keptJpy: 337660, savingsRatePct: 67.5,
  expenseCount: 2, largestJpy: 18900, needJpy: 32400, wantJpy: 18900,
  byCategory: [], byCycle: [], sentByPurpose: [], loan: null, sip: null,
  budgets: { overCount: 1, nearCount: 0, rows: [] },
  targets: [{ key: 'savings', targetValue: 300000, actualValue: 337660, diff: 37660, met: true }],
}

type MountOpts = {
  budgets?: unknown
  targets?: unknown
  dashboard?: unknown
  copyPreviousResponses?: Response[]
  onPutBudgets?: (body: unknown) => void
}

async function mountBudgets(opts: MountOpts = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  let copyCallCount = 0
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/me') return jsonResponse(ME)
    if (url.endsWith('/copy-previous') || url.includes('/copy-previous?')) {
      const resp = opts.copyPreviousResponses?.[copyCallCount] ?? jsonResponse(TARGETS_OCT)
      copyCallCount += 1
      return resp
    }
    if (url.startsWith('/api/targets/')) return jsonResponse(opts.targets ?? TARGETS_OCT)
    if (url.startsWith('/api/dashboard')) return jsonResponse(opts.dashboard ?? DASHBOARD_OCT)
    if (url.startsWith('/api/budgets') && (!init || init.method === undefined)) return jsonResponse(opts.budgets ?? BUDGETS_OCT)
    if (url === '/api/budgets' && init?.method === 'PUT') {
      opts.onPutBudgets?.(JSON.parse(String(init.body)))
      return jsonResponse(opts.budgets ?? BUDGETS_OCT)
    }
    throw new Error(`unexpected fetch(${url}, ${init?.method ?? 'GET'})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/budgets', component: BudgetsPage }] })
  router.push('/budgets')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(BudgetsPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  await waitUntil(() => wrapper.find('[data-testid="cycle-label"]').exists())
  return { wrapper, calls }
}

describe('BudgetsPage row state words', () => {
  it('shows "Over by ¥x" for an over-budget category, and no word for one with no budget', async () => {
    const { wrapper } = await mountBudgets()
    expect(wrapper.text()).toContain('Dining out')
    expect(wrapper.text()).toContain('Over by ￥3,900')
    expect(wrapper.text()).toContain('Groceries')
    wrapper.unmount()
  })
})

describe('BudgetsPage save body', () => {
  it('PUTs only the changed budget item, blank -> null', async () => {
    let putBody: unknown = null
    const { wrapper } = await mountBudgets({ onPutBudgets: (b) => { putBody = b } })

    // Clear the one budgeted category's field (removes its budget) — the unbudgeted category's
    // blank field is untouched, so it must not appear in the PUT body at all.
    const diningRow = wrapper.findAll('.brow').find((r) => r.text().includes('Dining out'))!
    await diningRow.find('input').setValue('')
    await flushPromises()

    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'Save')!
    await saveBtn.trigger('click')
    await waitUntil(() => putBody !== null)

    expect(putBody).toEqual({ cycle: '2026-10', items: [{ categoryId: CAT_OVER, amountJpy: null }] })
    wrapper.unmount()
  })
})

describe('BudgetsPage "Copy last cycle" 409 -> confirm -> overwrite', () => {
  it('shows a confirm dialog on 409, then retries with ?overwrite=true', async () => {
    const conflict = new Response(JSON.stringify({ error: { code: 'CONFLICT', message: '2026-10 already has targets' } }), {
      status: 409, headers: { 'content-type': 'application/json' },
    })
    const copied = jsonResponse({ cycle: '2026-10', savingsJpy: 400000, emergencyFundJpy: 60000, remittanceJpy: 150000, prepaymentPaise: 0 })
    const { wrapper, calls } = await mountBudgets({ copyPreviousResponses: [conflict, copied] })

    const copyBtn = wrapper.findAll('button').find((b) => b.text() === 'Copy last cycle')!
    await copyBtn.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain("Replace this cycle's targets?")

    const replaceBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Replace') as HTMLButtonElement
    replaceBtn.click()
    await waitUntil(() => calls.filter((c) => c.url.includes('copy-previous')).length >= 2)

    const overwriteCall = calls.find((c) => c.url.includes('overwrite=true'))
    expect(overwriteCall).toBeTruthy()
    await waitUntil(() => wrapper.text().includes('400,000'))

    wrapper.unmount()
  })
})
