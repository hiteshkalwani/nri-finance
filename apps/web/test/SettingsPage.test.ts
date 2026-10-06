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
vi.mock('../src/lib/session', () => ({ useSignOut: () => vi.fn() }))

import { createVuetify } from 'vuetify'
import SettingsPage from '../src/pages/SettingsPage.vue'

const vuetify = createVuetify()

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function mountSettings() {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/me' && (!init || init.method === undefined)) {
      return jsonResponse({
        userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
        profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
      })
    }
    if (url === '/api/me' && init?.method === 'PUT') {
      return jsonResponse({
        userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
        profile: { emergencyFundGoalJpy: null, ...JSON.parse(String(init.body)) },
      })
    }
    if (url === '/api/categories') return jsonResponse({ items: [] })
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings', component: SettingsPage }, { path: '/spend/new', component: { template: '<div/>' } }],
  })
  router.push('/settings')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(SettingsPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  for (let i = 0; i < 6; i++) await flushPromises()
  return { wrapper, fetchMock }
}

describe('SettingsPage profile form (finding 5: Enter must save, same as clicking Save)', () => {
  // jsdom doesn't implement a browser's native "Enter in a form field submits the form" behaviour
  // (confirmed: dispatching a synthetic `keydown`/Enter on a field never fires the form's `submit`
  // event here), so the Enter case itself isn't directly simulable. What *is* verifiable, and what
  // the regression actually was: "Save profile" must be a real submit control *of* `#profile-form`
  // (a multi-field `<form>` with no submit button inside it doesn't submit on Enter at all, in any
  // browser) — and submitting that form must call `submitProfile` exactly once, not twice (it
  // would, if the button still also carried its own `@click` alongside the form's `@submit`).
  it('wires "Save profile" as a real submit control of the profile form, with no separate click handler to double-submit', async () => {
    const { wrapper } = await mountSettings()

    const form = wrapper.get('#profile-form')
    const button = wrapper.get('.profile-actions button')
    expect(button.attributes('type')).toBe('submit')
    expect(button.attributes('form')).toBe(form.attributes('id'))

    wrapper.unmount()
  })

  it('saves the profile when the form is submitted (what a real browser does on Enter)', async () => {
    const { wrapper, fetchMock } = await mountSettings()

    const salary = wrapper.get('#salary').element as HTMLInputElement
    salary.value = '600000'
    salary.dispatchEvent(new Event('input'))
    await flushPromises()

    await wrapper.get('#profile-form').trigger('submit')
    for (let i = 0; i < 4; i++) await flushPromises()

    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCalls.length).toBe(1)

    wrapper.unmount()
  })
})

describe('SettingsPage emergency-fund goal field (Task 9)', () => {
  it('sends the typed goal (commas stripped) as a number on save', async () => {
    const { wrapper, fetchMock } = await mountSettings()

    const goal = wrapper.get('#ef-goal').element as HTMLInputElement
    goal.value = '1,200,000'
    goal.dispatchEvent(new Event('input'))
    await flushPromises()

    await wrapper.get('#profile-form').trigger('submit')
    for (let i = 0; i < 4; i++) await flushPromises()

    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCalls.length).toBe(1)
    const body = JSON.parse(String((putCalls[0]![1] as RequestInit).body))
    expect(body.emergencyFundGoalJpy).toBe(1200000)

    wrapper.unmount()
  })

  it('sends null when the goal field is left blank', async () => {
    const { wrapper, fetchMock } = await mountSettings()

    const goal = wrapper.get('#ef-goal').element as HTMLInputElement
    goal.value = ''
    goal.dispatchEvent(new Event('input'))
    await flushPromises()

    await wrapper.get('#profile-form').trigger('submit')
    for (let i = 0; i < 4; i++) await flushPromises()

    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCalls.length).toBe(1)
    const body = JSON.parse(String((putCalls[0]![1] as RequestInit).body))
    expect(body.emergencyFundGoalJpy).toBeNull()

    wrapper.unmount()
  })

  it('shows a field error and does not save when the goal is not a valid whole yen amount', async () => {
    const { wrapper, fetchMock } = await mountSettings()

    const goal = wrapper.get('#ef-goal').element as HTMLInputElement
    goal.value = '-5'
    goal.dispatchEvent(new Event('input'))
    await flushPromises()

    await wrapper.get('#profile-form').trigger('submit')
    for (let i = 0; i < 4; i++) await flushPromises()

    expect(wrapper.text()).toContain('Enter a whole number of yen, 0 or more.')
    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCalls.length).toBe(0)

    wrapper.unmount()
  })
})

describe('SettingsPage import result message (Task 9: profile-kept sentence)', () => {
  it('appends the profile-kept sentence when the import result says profileKept', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/me' && (!init || init.method === undefined)) {
        return jsonResponse({
          userId: '99999999-9999-4999-8999-999999999999', email: 'me@example.test',
          profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null },
        })
      }
      if (url === '/api/categories') return jsonResponse({ items: [] })
      if (url === '/api/import/v1' && init?.method === 'POST') {
        return jsonResponse({
          inserted: { transactions: 3, remittances: 0, categories: 1, accounts: 2, loans: 0, plannedPrepayments: 0, sipPlans: 0, cycleTargets: 0 },
          skippedRows: [], profileKept: true,
        })
      }
      throw new Error(`unexpected fetch(${url})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/settings', component: SettingsPage }, { path: '/spend/new', component: { template: '<div/>' } }],
    })
    router.push('/settings')
    await router.isReady()
    const queryClient = new QueryClient()
    const wrapper = mount(SettingsPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
    for (let i = 0; i < 6; i++) await flushPromises()

    const v1Doc = {
      settings: {
        salaryJPY: 500000, jpyPerInr: 1.7,
        homeLoan: { principalINR: 0, annualRatePct: 0, emiINR: 0, tenureMonths: 0, startCycle: '2026-01' },
        sip: { startingMonthlyINR: 0, annualStepUpPct: 0, estimatedReturnPct: 0, allocation: {} },
      },
      categories: [], transactions: [],
    }
    const input = wrapper.get('#import-file').element as HTMLInputElement
    const file = new File([JSON.stringify(v1Doc)], 'finance-data.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    for (let i = 0; i < 6; i++) await flushPromises()

    expect(wrapper.text()).toContain('Profile kept: settings from the file were not imported.')

    wrapper.unmount()
  })
})

describe('SettingsPage import drop zone (finding 9)', () => {
  it('resets the file input after reading, so choosing the same file again still fires change', async () => {
    const { wrapper } = await mountSettings()
    const input = wrapper.get('#import-file').element as HTMLInputElement
    const file = new File(['not json'], 'finance-data.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })

    // jsdom's file input never actually reflects `files` back through `.value` (it's hard-coded
    // to read back '' regardless), so the only way to observe whether the fix set it is to spy on
    // the setter directly, rather than reading `.value` back afterwards.
    const sets: string[] = []
    Object.defineProperty(input, 'value', { get: () => '', set: (v: string) => sets.push(v), configurable: true })

    input.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(sets).toEqual([''])

    wrapper.unmount()
  })

  it('does not drop the dragover state when the pointer moves between elements inside the drop zone', async () => {
    const { wrapper } = await mountSettings()
    const zone = wrapper.get('.drop')

    await zone.trigger('dragover')
    expect(zone.classes()).toContain('dragover')

    // jsdom has no DragEvent constructor; a plain Event with `relatedTarget` defined on it reads
    // the same way to the handler (it only reads `e.relatedTarget`/`e.currentTarget`).
    const dragLeaveTo = (related: Node | null) => {
      const e = new Event('dragleave', { bubbles: true })
      Object.defineProperty(e, 'relatedTarget', { value: related })
      zone.element.dispatchEvent(e)
    }

    // The label has child elements (the bold filename, the hint line); moving the pointer between
    // them fires a native dragleave on the label even though the pointer never actually left it.
    dragLeaveTo(zone.element.querySelector('b')!)
    await flushPromises()
    expect(zone.classes()).toContain('dragover')

    // Actually leaving the drop zone (relatedTarget outside it, or null) does clear it.
    dragLeaveTo(document.body)
    await flushPromises()
    expect(zone.classes()).not.toContain('dragover')

    wrapper.unmount()
  })
})
