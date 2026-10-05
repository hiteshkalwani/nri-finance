import { expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { session } from '../src/lib/session'
import { handleUnauthorized } from '../src/lib/unauthorized'

const Blank = { template: '<div />' }
async function routerAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/settings', '/login'].map((p) => ({ path: p, component: Blank, meta: { public: p === '/login' } })),
  })
  await router.push(path)
  return router
}

it('opens the sign-in dialog and stays on the page, so a half-filled form survives (AUTH-2)', async () => {
  session.dialogOpen.value = false
  const router = await routerAt('/settings?tab=import')
  expect(handleUnauthorized(router)).toBe('dialog')
  expect(session.dialogOpen.value).toBe(true)
  expect(router.currentRoute.value.fullPath).toBe('/settings?tab=import')
})

it('does nothing on the sign-in page itself', async () => {
  session.dialogOpen.value = false
  expect(handleUnauthorized(await routerAt('/login'))).toBe('ignored')
  expect(session.dialogOpen.value).toBe(false)
})
