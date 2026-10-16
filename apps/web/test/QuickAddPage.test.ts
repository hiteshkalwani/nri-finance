import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

// Vuetify's VTextField `autofocus` prop only acts once an IntersectionObserver reports the field
// visible (vuetify/lib/composables/autofocus.js) — `SUPPORTS_INTERSECTION` is read once, at module
// load, from `window.IntersectionObserver`, so this fake has to exist *before* `vuetify` is first
// imported anywhere in this file. `vi.hoisted` runs before every import below for exactly that
// reason (plain top-of-file code would not: imports are hoisted above it).
vi.hoisted(() => {
  /** Reports every observed element as immediately intersecting — enough to exercise Vuetify's
   *  intersect directive without a real layout engine. */
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

  // jsdom has no ResizeObserver either, and VSlideGroup (which VChipGroup renders internally)
  // uses one in its own setup(); a missing one throws there, before it ever renders.
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))

import { createVuetify } from 'vuetify'
import QuickAddPage from '../src/pages/QuickAddPage.vue'

const vuetify = createVuetify()
const CATEGORY_ID = '11111111-1111-4111-8111-111111111111'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function mountQuickAdd(budgets: unknown = { cycle: '2026-10', rows: [] }) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url === '/api/me') return jsonResponse({ profile: { salaryJpy: 500000, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo', emergencyFundGoalJpy: null } })
    if (url === '/api/categories') {
      return jsonResponse({
        items: [
          { id: CATEGORY_ID, name: 'Groceries', color: '#4caf50', icon: null, sortOrder: 0, archived: false, inUse: true, lastPaymentMethod: null, lastNeedWant: null },
        ],
      })
    }
    if (url.startsWith('/api/budgets')) return jsonResponse(budgets)
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/spend/new', component: QuickAddPage }, { path: '/spend', component: { template: '<div/>' } }],
  })
  router.push('/spend/new')
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(QuickAddPage, { global: { plugins: [router, vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('QuickAddPage autofocus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Regression for the known flake (task 7, carried item 1): typing into #description sometimes
  // landed in #amount because the amount field's autofocus fired late. Root cause: Vuetify's
  // `autofocus` prop (vuetify/lib/composables/autofocus.js) focuses the field from an
  // IntersectionObserver callback, *and then waits another 50ms* before actually calling
  // `focus()` — so moving focus to another field inside that 50ms window has it stolen back once
  // the delayed call fires. This test mounts the real page, moves focus to #description well
  // inside that window, then advances past it.
  it('does not steal focus back to #amount once the user has moved to #description', async () => {
    const wrapper = await mountQuickAdd()
    // Let the fake IntersectionObserver's queued microtask run, so Vuetify's own delayed
    // (setTimeout) focus call — if the page still relies on the flaky `autofocus` prop — gets
    // registered. Real promise microtasks still resolve under fake timers.
    await vi.advanceTimersByTimeAsync(0)

    const description = wrapper.get('#description').element as HTMLInputElement
    description.focus()
    description.value = 'g'
    description.dispatchEvent(new Event('input'))
    expect(document.activeElement).toBe(description)

    // Past Vuetify's 50ms delayed autofocus call: before the fix, this steals focus back to
    // #amount even though the user already moved to #description.
    await vi.advanceTimersByTimeAsync(60)
    expect(document.activeElement).toBe(description)

    wrapper.unmount()
  })

  // Fix round 1: the first guard (`document.activeElement === document.body`) assumed "nothing
  // focused yet" was the only way to arrive here un-focused — but the real "Add expense" link
  // lives in App.vue's persistent sidebar/bottom-nav, *outside* this page's `<router-view>`, and
  // keeps its own focus across the route change (Vue Router doesn't blur it). That left
  // `document.activeElement` pointing at that link, not `document.body`, so the old guard wrongly
  // skipped focusing #amount on every real in-app navigation to quick-add — only a fresh page
  // load (activeElement genuinely `body`) ever got it. Simulates that link with a plain focused
  // button living outside anything this component renders.
  it('focuses #amount on mount even when something outside the page is already focused (e.g. the persistent nav link)', async () => {
    const navLink = document.createElement('button')
    navLink.textContent = 'Add expense'
    document.body.appendChild(navLink)
    navLink.focus()
    expect(document.activeElement).toBe(navLink)

    const wrapper = await mountQuickAdd()
    const amount = wrapper.get('#amount').element as HTMLInputElement
    expect(document.activeElement).toBe(amount)

    wrapper.unmount()
    navLink.remove()
  })
})

describe('QuickAddPage remaining-budget hint (BUD-2)', () => {
  async function selectGroceries(wrapper: Awaited<ReturnType<typeof mountQuickAdd>>) {
    const chip = wrapper.findAll('[role="radio"]').find((el) => el.text().includes('Groceries'))!
    await chip.trigger('click')
    await flushPromises()
  }

  it('shows "¥x left this cycle" once a budgeted category is picked', async () => {
    const wrapper = await mountQuickAdd({
      cycle: '2026-10',
      rows: [{ categoryId: CATEGORY_ID, name: 'Groceries', color: '#4caf50', budgetJpy: 35000, effectiveFromCycle: '2026-09', spentJpy: 32400, remainingJpy: 2600, pct: 92.6, state: 'near' }],
    })
    await selectGroceries(wrapper)
    expect(wrapper.text()).toContain('￥2,600 left this cycle')
    wrapper.unmount()
  })

  it('shows "Over by ¥x" once an over-budget category is picked', async () => {
    const wrapper = await mountQuickAdd({
      cycle: '2026-10',
      rows: [{ categoryId: CATEGORY_ID, name: 'Groceries', color: '#4caf50', budgetJpy: 30000, effectiveFromCycle: '2026-09', spentJpy: 32400, remainingJpy: -2400, pct: 108, state: 'over' }],
    })
    await selectGroceries(wrapper)
    expect(wrapper.text()).toContain('Over by ￥2,400')
    wrapper.unmount()
  })

  it('shows nothing when the category has no budget set', async () => {
    const wrapper = await mountQuickAdd({
      cycle: '2026-10',
      rows: [{ categoryId: CATEGORY_ID, name: 'Groceries', color: '#4caf50', budgetJpy: null, effectiveFromCycle: null, spentJpy: 32400, remainingJpy: null, pct: null, state: null }],
    })
    await selectGroceries(wrapper)
    expect(wrapper.text()).not.toContain('left this cycle')
    expect(wrapper.text()).not.toContain('Over by')
    wrapper.unmount()
  })
})
