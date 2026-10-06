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
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }), signOut: async () => ({ error: null }) } },
}))

import { createVuetify } from 'vuetify'
import App from '../src/App.vue'

/** Display width is captured once at `createVuetify()` time (vuetify's `useDisplay`), so
 * `window.innerWidth` must already be phone-sized (390) before this runs — same technique as
 * AccountsPage.test.ts's `createMobileVuetify`. */
function createMobileVuetify() {
  const original = window.innerWidth
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
  const mobile = createVuetify()
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: original })
  return mobile
}

async function mountAppAt(path: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))

  const stub = { template: '<div/>' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: stub },
      { path: '/spend', component: stub },
      { path: '/spend/new', component: stub },
      { path: '/accounts', component: stub },
      { path: '/accounts/balances', component: stub },
      { path: '/settings', component: stub },
      { path: '/login', component: stub, meta: { public: true } },
    ],
  })
  router.push(path)
  await router.isReady()
  const queryClient = new QueryClient()
  const wrapper = mount(App, { global: { plugins: [router, createMobileVuetify(), [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

function moreButton(): HTMLButtonElement {
  return Array.from(document.querySelectorAll('.bottom-nav button')).find((b) => b.textContent?.includes('More')) as HTMLButtonElement
}

// Final whole-branch review finding 6: the phone bottom nav's "More" entry opens Accounts and
// Settings but never itself showed as the active tab, even while sitting on one of those two
// pages — unlike Dashboard/Spend, which get Vuetify's router-link highlighting for free via `to`.
describe('App bottom navigation "More" active state', () => {
  it('highlights More while on /accounts', async () => {
    const wrapper = await mountAppAt('/accounts')
    expect(moreButton().classList.contains('v-btn--active')).toBe(true)
    wrapper.unmount()
  })

  it('highlights More while on /settings', async () => {
    const wrapper = await mountAppAt('/settings')
    expect(moreButton().classList.contains('v-btn--active')).toBe(true)
    wrapper.unmount()
  })

  it('does not highlight More on Dashboard or Spend', async () => {
    const dash = await mountAppAt('/')
    expect(moreButton().classList.contains('v-btn--active')).toBe(false)
    dash.unmount()

    const spend = await mountAppAt('/spend')
    expect(moreButton().classList.contains('v-btn--active')).toBe(false)
    spend.unmount()
  })
})
