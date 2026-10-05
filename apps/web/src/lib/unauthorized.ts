import type { Router } from 'vue-router'
import { openSignIn } from './session'

/**
 * On a 401 from the API during a session: open the sign-in dialog over the current page instead of navigating away,
 * so anything typed into a form stays (AUTH-2). Navigation without a session is handled by the router guard.
 */
export function handleUnauthorized(router: Router): 'dialog' | 'ignored' {
  if (router.currentRoute.value.meta.public) return 'ignored'
  openSignIn()
  return 'dialog'
}
