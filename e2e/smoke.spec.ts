import { readFileSync } from 'node:fs'
import { devices, expect, test, type Page } from '@playwright/test'

const user = JSON.parse(readFileSync('.e2e-user.json', 'utf8')) as { email: string; password: string }
// The three tests share the one e2e user and the data the earlier tests create, so they must run
// together, in order, in one worker.
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
  // The Categories card must refetch after import, not just show whatever it had cached (I3).
  await expect(page.getByText('Groceries')).toBeVisible()
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('income')).toHaveText('￥670,000')
  expect(page.viewportSize()?.width).toBe(412) // still the config's Pixel 7 phone viewport
})

test('quick-add an expense on the phone and see it on the dashboard and in the ledger (TXN-2, DASH-2)', async ({ page }) => {
  await signIn(page, '/')
  expect(page.viewportSize()?.width).toBe(412) // still the config's Pixel 7 phone viewport
  const before = yen(await page.getByTestId('spent').textContent())
  await page.getByRole('link', { name: 'Add expense' }).click()
  await page.locator('#amount').fill('1234')
  const firstCategory = page.locator('.v-chip-group[aria-label="Category"] .v-chip').first()
  await firstCategory.click()
  // Guard for the selected-tile grey-wash regression (fix round 2): the tile's own background
  // must still be the plain surface colour (white in light theme) once selected, not darkened by
  // a leftover overlay or ripple — `toHaveCSS` polls, so this also covers the ripple's own 0.3s
  // fade-out rather than racing it.
  await expect(firstCategory).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.locator('#description').fill('e2e quick-add')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('saved')).toContainText('￥1,234')
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect.poll(async () => yen(await page.getByTestId('spent').textContent())).toBe(before + 1234)
  await page.getByRole('link', { name: 'Spend' }).click()
  await expect(page.getByText('e2e quick-add')).toBeVisible()
})

test('record a transfer and see it on Remit and the Dashboard (REM-1..5, DASH-4)', async ({ page }) => {
  await signIn(page, '/')
  expect(page.viewportSize()?.width).toBe(412) // still the config's Pixel 7 phone viewport
  const before = yen(await page.getByTestId('sent').textContent())
  await page.getByRole('link', { name: 'Remit' }).click()
  await expect(page).toHaveURL(/\/remit$/)
  await page.getByRole('link', { name: 'Record transfer' }).click()
  await expect(page).toHaveURL(/\/remit\/new$/)
  await page.locator('#jpySent').fill('85000')
  await page.locator('#inrPaise').fill('50000')
  // Same Vuetify v-select quirk as AccountDialog's Type field (ACC-1): the field's own text area
  // is a "no activator" zone, so only its dropdown icon opens the menu. Two selects on this page
  // (From/To), so scope each click to its own field by its floating label text.
  await page.locator('.v-select', { hasText: 'From (Japan account)' }).locator('.v-select__menu-icon').click()
  await page.getByRole('option', { name: 'Japan bank' }).click()
  await page.locator('.v-select', { hasText: 'To (India account)' }).locator('.v-select__menu-icon').click()
  await page.getByRole('option', { name: 'India bank' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/remit$/)
  await expect(page.getByText('Transfer recorded')).toBeVisible()
  await expect(page.getByText('Japan bank → India bank')).toBeVisible()
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect.poll(async () => yen(await page.getByTestId('sent').textContent())).toBe(before + 85000)
})

test.describe('on a laptop', () => {
  // Playwright 1.63 forbids test.use() of worker-scoped fixtures (e.g. defaultBrowserType, which
  // `devices['Desktop Chrome']` sets) inside a describe group — "forces a new worker" — so that
  // field is explicitly left out here; only the test-scoped viewport/UA/etc. apply.
  // `channel: 'chrome'` is already set for every test by the config, so it's not repeated.
  const { userAgent, viewport, screen, deviceScaleFactor, isMobile, hasTouch } = devices['Desktop Chrome']
  test.use({ userAgent, viewport, screen, deviceScaleFactor, isMobile, hasTouch })

  test('find an expense, edit its amount, delete it and undo (TXN-1, TXN-3)', async ({ page }) => {
    await signIn(page, '/spend')
    expect(page.viewportSize()?.width).toBe(1280) // now the Desktop Chrome viewport, not Pixel 7
    await page.locator('#search').fill('e2e quick-add')
    // Default sort is date, so the filtered list still renders its date-group header (spec §4.2).
    await expect(page.locator('.day-row').first()).toBeVisible()
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

  test('a pending Undo does not resurface after navigating away, nor survive sign-out (Minor 1)', async ({ page }) => {
    await signIn(page, '/spend')
    // Delete, navigate away (unmounting the ledger) and back — the stale snackbar must not resurface.
    await page.locator('#search').fill('e2e quick-add')
    await page.getByText('e2e quick-add').click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page).toHaveURL(/\/$/) // wait for the navigation to actually land before coming back,
    await page.getByRole('link', { name: 'Spend' }).click() // so the ledger truly unmounts and remounts
    await expect(page).toHaveURL(/\/spend$/)
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)

    // Delete another row, sign out immediately (before the 5s timeout), sign back in — still cleared.
    await page.getByRole('link', { name: 'Add expense' }).click()
    await page.locator('#amount').fill('1')
    const firstChip = page.locator('.v-chip-group[aria-label="Category"] .v-chip').first()
    await expect(firstChip).toBeVisible()
    await firstChip.click()
    await page.locator('#description').fill('e2e minor1')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('saved')).toBeVisible()
    await page.getByRole('link', { name: 'Spend' }).click()
    await page.getByText('e2e minor1').click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await signIn(page, page.url())
    await page.getByRole('link', { name: 'Spend' }).click()
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  })

  test('add an account, update its balance, see net worth on Accounts and the Dashboard (ACC-1, BAL-1, BAL-2, DASH-5, DASH-6)', async ({ page }) => {
    await signIn(page, '/accounts')
    expect(page.viewportSize()?.width).toBe(1280) // still the Desktop Chrome viewport
    await page.getByRole('button', { name: 'Add account' }).click()
    await page.locator('#account-name').fill('e2e Wise')
    await page.getByRole('button', { name: 'JP', exact: true }).click()
    // The Type field's own text/input area is a Vuetify "no activator" zone (it supports text
    // selection), so only its dropdown icon actually opens the menu.
    await page.locator('.v-select__menu-icon').click()
    await page.getByRole('option', { name: 'Bank' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('e2e Wise')).toBeVisible() // saved row visible back on Accounts

    await page.getByRole('link', { name: 'Update balances' }).click()
    await expect(page).toHaveURL(/\/accounts\/balances$/)
    // The e2e user's other imported starter accounts (Japan bank, Japan emergency fund, India
    // bank) have no balances, so this is the only figure feeding the net-worth total below.
    await page.getByLabel('Balance for e2e Wise').fill('100000')
    await page.getByRole('button', { name: 'Save balances' }).click()

    await expect(page).toHaveURL(/\/accounts$/)
    await expect(page.getByText(/Balances saved for/)).toBeVisible()
    await expect(page.getByTestId('net-worth-total')).toContainText('100,000')

    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('networth')).toContainText('100,000')
  })

  test('see the recorded transfer on Remit and the Dashboard at full width (REM-4, DASH-4)', async ({ page }) => {
    await signIn(page, '/remit')
    expect(page.viewportSize()?.width).toBe(1280) // still the Desktop Chrome viewport
    await expect(page.getByText('Japan bank → India bank')).toBeVisible()
    await expect(page.locator('.kpi', { hasText: 'Sent this cycle' })).toContainText('85,000')
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page.getByTestId('sent')).toContainText('85,000')
  })
})

test('bottom-nav "More" opens a menu with Accounts, and it navigates to /accounts', async ({ page }) => {
  await signIn(page, '/')
  expect(page.viewportSize()?.width).toBe(412) // still the config's Pixel 7 phone viewport
  await page.getByRole('button', { name: 'More' }).click()
  // `exact: true`: by now the Dashboard's own net-worth card (populated by the previous laptop
  // test's saved balance) also has a "View accounts" link, which would otherwise substring-match.
  await page.getByRole('link', { name: 'Accounts', exact: true }).click()
  await expect(page).toHaveURL(/\/accounts$/)
})
