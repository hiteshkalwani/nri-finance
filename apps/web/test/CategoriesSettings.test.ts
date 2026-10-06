import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

// VMenu/VList need a ResizeObserver in jsdom (Vuetify's overlay positioning uses one); a missing
// one throws before the component ever renders — see QuickAddPage.test.ts's matching fake.
vi.hoisted(() => {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

// apiFetch calls supabase.auth.getSession() before every request — without this, the real client
// tries to reach a real backend and the categories query never settles (stays "loading" forever).
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))

import { createVuetify } from 'vuetify'
import CategoriesSettings from '../src/components/CategoriesSettings.vue'

const vuetify = createVuetify()

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function mountCategoriesSettings() {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url === '/api/categories') {
      return jsonResponse({
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111', name: 'Groceries', color: '#4caf50', icon: null, sortOrder: 0,
            archived: false, inUse: true, lastPaymentMethod: null, lastNeedWant: null,
          },
          {
            id: '22222222-2222-4222-8222-222222222222', name: 'Rent', color: '#2196f3', icon: null, sortOrder: 1,
            archived: false, inUse: false, lastPaymentMethod: null, lastNeedWant: null,
          },
        ],
      })
    }
    throw new Error(`unexpected fetch(${url})`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const queryClient = new QueryClient()
  const wrapper = mount(CategoriesSettings, { global: { plugins: [vuetify, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body })
  // apiFetch awaits supabase.auth.getSession() before the fetch itself — two awaits before the
  // query settles, so a single flushPromises() isn't always enough to drain both.
  for (let i = 0; i < 5; i++) await flushPromises()
  return wrapper
}

describe('CategoriesSettings row action names (fix round 1, item 1)', () => {
  it('names each row\'s action buttons after its category, not a generic label', async () => {
    const wrapper = await mountCategoriesSettings()

    expect(wrapper.find('button[aria-label="Colour for Groceries"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Icon for Groceries"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Rename Groceries"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="More actions for Groceries"]').exists()).toBe(true)

    expect(wrapper.find('button[aria-label="Colour for Rent"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Icon for Rent"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Rename Rent"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="More actions for Rent"]').exists()).toBe(true)

    // The old generic names must be gone from each row (the new-category row above the list
    // legitimately keeps "Colour"/"Icon" — there's no category yet to name them after).
    const rows = wrapper.findAll('.crow')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.find('button[aria-label="Colour"]').exists()).toBe(false)
      expect(row.find('button[aria-label="Icon"]').exists()).toBe(false)
      expect(row.find('button[aria-label="Rename"]').exists()).toBe(false)
      expect(row.find('button[aria-label="More actions"]').exists()).toBe(false)
    }

    wrapper.unmount()
  })

  // jsdom's default window.innerWidth (1024) is above Vuetify's `xs` breakpoint (<600), so this
  // exercises the "wide screen" branch — move up/down inline, not just in the overflow menu
  // (fix round 1, item 2: this was an M1 regression once they moved into the menu for every width).
  it('shows inline, per-category Move up/down buttons on wide screens', async () => {
    const wrapper = await mountCategoriesSettings()

    const up = wrapper.find('button[aria-label="Move Groceries up"]')
    const down = wrapper.find('button[aria-label="Move Groceries down"]')
    expect(up.exists()).toBe(true)
    expect(down.exists()).toBe(true)
    // First row: up is disabled (already at the top); down is not (Rent follows it).
    expect(up.attributes('disabled')).toBeDefined()
    expect(down.attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })
})
