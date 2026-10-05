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
})
