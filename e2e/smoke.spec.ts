import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const user = JSON.parse(readFileSync('.e2e-user.json', 'utf8')) as { email: string; password: string }

test('sign in, import v1 data, see the profile', async ({ page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)settings/)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/settings$/) // returned to where the guard stopped us (AUTH-2)

  await page.locator('#import-file').setInputFiles('legacy/seed-data.json')
  await expect(page.getByText(/Imported \d+ transactions/)).toBeVisible()

  await page.getByRole('link', { name: 'Home' }).click()
  await expect(page.getByTestId('salary')).toHaveText('Salary: ¥500,000 / month')
})
