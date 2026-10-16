import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from './lib/supabase'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/', component: () => import('./pages/DashboardPage.vue') },
    { path: '/accounts/balances', component: () => import('./pages/UpdateBalancesPage.vue') },
    { path: '/accounts', component: () => import('./pages/AccountsPage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/spend/new', component: () => import('./pages/QuickAddPage.vue') },
    { path: '/spend', component: () => import('./pages/LedgerPage.vue') },
    { path: '/spend/:id', component: () => import('./pages/EditTransactionPage.vue') },
    { path: '/remit/new', component: () => import('./pages/RemitFormPage.vue') },
    { path: '/remit', component: () => import('./pages/RemitPage.vue') },
    { path: '/remit/:id', component: () => import('./pages/RemitFormPage.vue') },
    { path: '/loans', component: () => import('./pages/LoanPage.vue') },
    { path: '/loans/:id', component: () => import('./pages/LoanPage.vue') },
    { path: '/sip', component: () => import('./pages/SipPage.vue') },
    { path: '/budgets', component: () => import('./pages/BudgetsPage.vue') },
    { path: '/review', component: () => import('./pages/ReviewPage.vue') },
    { path: '/review/:cycle', component: () => import('./pages/ReviewPage.vue') },
    { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFoundPage.vue'), meta: { public: true } },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  const { data } = await supabase.auth.getSession()
  return data.session ? true : { path: '/login', query: { next: to.fullPath } }
})
