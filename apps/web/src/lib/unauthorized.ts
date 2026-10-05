import type { Router } from 'vue-router'

/** On a 401 from the API: go to sign-in, remembering the page to come back to (AUTH-2). */
export function redirectToLogin(router: Router) {
  const current = router.currentRoute.value
  if (current.path === '/login') return undefined
  return router.push({ path: '/login', query: { next: current.fullPath } })
}
