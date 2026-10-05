import { expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { redirectToLogin } from '../src/lib/unauthorized'

const Blank = { template: '<div />' }
async function routerAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/settings', '/login'].map((p) => ({ path: p, component: Blank })),
  })
  await router.push(path)
  return router
}

it('sends me to sign-in and remembers the page I was on, query included (AUTH-2)', async () => {
  const router = await routerAt('/settings?tab=import')
  await redirectToLogin(router)
  expect(router.currentRoute.value.path).toBe('/login')
  expect(router.currentRoute.value.query.next).toBe('/settings?tab=import')
})

it('does nothing when I am already on the sign-in page', async () => {
  const router = await routerAt('/login?next=/settings')
  expect(redirectToLogin(router)).toBeUndefined()
  expect(router.currentRoute.value.fullPath).toBe('/login?next=/settings')
})
