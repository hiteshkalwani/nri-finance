import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from './lib/supabase'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/', component: () => import('./pages/HomePage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFoundPage.vue'), meta: { public: true } },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  const { data } = await supabase.auth.getSession()
  return data.session ? true : { path: '/login', query: { next: to.fullPath } }
})
