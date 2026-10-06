import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createVuetify } from 'vuetify'
import type { Category, Transaction } from '@nri/contracts'
import ExpenseRow from '../src/components/ExpenseRow.vue'

const vuetify = createVuetify()

const baseT: Transaction = {
  id: 'abc-123', occurredOn: '2026-10-05', cycle: '2026-10', categoryId: 'cat-1', accountId: null,
  description: '', amountJpy: 1280, enteredCurrency: 'JPY', amountInrPaise: null, rateUsed: null,
  paymentMethod: 'ic_card', needWant: 'need', notes: '',
}
const baseCategory: Category = {
  id: 'cat-1', name: 'Dining out', color: '#f0682e', icon: null, sortOrder: 0, archived: false,
  inUse: true, lastPaymentMethod: null, lastNeedWant: null,
}

async function mountRow(t: Transaction, category: Category | undefined) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/spend/:id', component: { template: '<div/>' } },
    ],
  })
  router.push('/')
  await router.isReady()
  return mount(ExpenseRow, { props: { t, category }, global: { plugins: [router, vuetify] } })
}

describe('ExpenseRow', () => {
  it('links to /spend/:id', async () => {
    const wrapper = await mountRow(baseT, baseCategory)
    expect(wrapper.get('a').attributes('href')).toBe('/spend/abc-123')
  })

  it('shows "(no description)" when the description is blank', async () => {
    const wrapper = await mountRow(baseT, baseCategory)
    expect(wrapper.text()).toContain('(no description)')
  })

  it('shows the ₹ line only for INR rows', async () => {
    const jpyRow = await mountRow(baseT, baseCategory)
    expect(jpyRow.text()).not.toContain('₹')

    const inrRow = await mountRow({ ...baseT, enteredCurrency: 'INR', amountInrPaise: 100000 }, baseCategory)
    expect(inrRow.text()).toContain('₹')
  })

  it('shows the category icon when set, otherwise the initial', async () => {
    const withIcon = await mountRow(baseT, { ...baseCategory, icon: '🍜' })
    expect(withIcon.text()).toContain('🍜')

    const withoutIcon = await mountRow(baseT, { ...baseCategory, icon: null })
    expect(withoutIcon.text()).toContain('D')
  })

  it('shows a consistent "Uncategorised"/"U" fallback when the category is missing', async () => {
    const wrapper = await mountRow(baseT, undefined)
    expect(wrapper.text()).toContain('Uncategorised')
    expect(wrapper.text()).toContain('U')
  })

  // Finding 7: the focus ring used `outline-offset: 2px` (positive — draws it *outside* the
  // element's border box) inside a `v-card` that clips overflow, so the ring's bottom/right edges
  // were cut off by the card's own boundary; it also used `primary-accent`, which only clears
  // 2.65:1 against the row's hover fill (surface-variant) in light theme — under WCAG 1.4.11's
  // 3:1 non-text minimum (theme.test.ts covers the actual contrast numbers; this just pins the
  // CSS that makes that fix real). `outline-offset: -2px` draws the ring *inside* the border box
  // instead, same as the app's own global ring (app.css), and `primary` is the token theme.ts
  // documents as cleared for exactly this non-text "ring against its surroundings" use.
  it('draws the focus ring inset (not clipped by an ancestor v-card) with the primary token, not primary-accent', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ExpenseRow.vue'), 'utf-8')
    const rule = /\.row:focus-visible\s*{([^}]*)}/.exec(source)
    expect(rule, 'expected a .row:focus-visible rule in ExpenseRow.vue').toBeTruthy()
    const body = rule![1]!
    expect(body).toMatch(/outline-offset:\s*-2px/)
    expect(body).toMatch(/outline:\s*2px solid rgb\(var\(--v-theme-primary\)\)/)
    expect(body).not.toMatch(/--v-theme-primary-accent/)
  })
})
