import { readFileSync } from 'node:fs'
import { devices, expect, test, type Page } from '@playwright/test'

const user = JSON.parse(readFileSync('.e2e-user.json', 'utf8')) as { email: string; password: string }
test.describe.configure({ mode: 'serial' })

async function signIn(page: Page, path: string) {
  await page.goto(path)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
const yen = (s: string | null) => Number((s ?? '').replace(/[^\d-]/g, ''))

test('sign in, import v1 data, see the profile', async ({ page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)settings/)
  await signIn(page, page.url())
  await expect(page).toHaveURL(/\/settings$/) // returned to where the guard stopped us (AUTH-2)
  await page.locator('#import-file').setInputFiles('legacy/seed-data.json')
  await expect(page.getByText(/Imported \d+ transactions/)).toBeVisible()
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('income')).toHaveText('￥500,000')
})

test('quick-add an expense on the phone and see it on the dashboard and in the ledger (TXN-2, DASH-2)', async ({ page }) => {
  await signIn(page, '/')
  const before = yen(await page.getByTestId('spent').textContent())
  await page.getByRole('link', { name: 'Add expense' }).click()
  await page.locator('#amount').fill('1234')
  await page.locator('.v-chip-group[aria-label="Category"] .v-chip').first().click()
  await page.locator('#description').fill('e2e quick-add')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('saved')).toContainText('￥1,234')
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect.poll(async () => yen(await page.getByTestId('spent').textContent())).toBe(before + 1234)
  await page.getByRole('link', { name: 'Spend' }).click()
  await expect(page.getByText('e2e quick-add')).toBeVisible()
})

// Playwright 1.63 forbids test.use() of worker-scoped fixtures (channel, defaultBrowserType from
// `devices[...]`) inside a describe group — "forces a new worker" — so it's set at file scope here
// and only the trailing test picks it up.
test.use({ ...devices['Desktop Chrome'], channel: 'chrome' })

test.describe('on a laptop', () => {
  test('find an expense, edit its amount, delete it and undo (TXN-1, TXN-3)', async ({ page }) => {
    await signIn(page, '/spend')
    await page.locator('#search').fill('e2e quick-add')
    await expect(page.getByTestId('ledger-total')).toContainText('1 expenses')
    await page.getByText('e2e quick-add').click()
    await page.locator('#amount').fill('2000')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.locator('#search').fill('e2e quick-add')
    await expect(page.getByTestId('ledger-total')).toContainText('￥2,000')
    await page.getByText('e2e quick-add').click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.locator('#search').fill('e2e quick-add')
    await expect(page.getByTestId('ledger-total')).toContainText('0 expenses')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('ledger-total')).toContainText('1 expenses')
  })
})
