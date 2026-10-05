import { defineConfig, devices } from '@playwright/test'

// `pnpm stack:check` sets E2E_BASE_URL to the built app in Docker (:3000); otherwise the test runs against Vite.
const external = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  workers: 1,
  use: { baseURL: external ?? 'http://localhost:5173', ...devices['Pixel 7'], channel: 'chrome', trace: 'retain-on-failure' },
  webServer: external
    ? undefined
    : { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
})
