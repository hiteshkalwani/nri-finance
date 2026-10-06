// Dev aid: screenshots the app's main screens so a mismatch against
// docs/diagrams/nri-ui-mockup.html is quick to spot by eye. Not part of the app, and not a test —
// `pnpm test:scripts` only discovers scripts/*.test.mjs, so this is never picked up there.
//
// Creates a single disposable @example.test user via @nri/test-utils (same admin API the e2e
// suite's global-setup.ts uses) and deletes it when done — it never touches your own local
// account (e.g. me@local.test) or the e2e suite's own .e2e-user.json. The user is seeded through
// the legacy v1 import (legacy/seed-data.json) so every screen has real data to show.
//
// Before each shot: move the mouse away, blur focus, and wait past a ripple's ~300ms fade-out —
// otherwise the last click's pointer position / ripple / focus ring shows up in the screenshot.
// Fails (non-zero exit) if any page logs a console error or throws an uncaught error.
//
// Secrets: .env.local is loaded (same as e2e/global-setup.ts) only to call the local auth admin
// API, and is never printed or written anywhere.
//
// Targets the already-built `pnpm stack:check` app at :3000 by default; pass
// BASE_URL=http://localhost:5173 to target `pnpm dev` instead.
//
// Run with: pnpm ui:screens
import { chromium } from '@playwright/test'
import { createTestUser, deleteTestUser } from '@nri/test-utils'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
process.chdir(root)
process.loadEnvFile('.env.local') // never printed; only used to call the local auth admin API

const outDir = path.join(root, '.superpowers/ui-screens')
mkdirSync(outDir, { recursive: true })
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

// `cycle=all` on /spend shows every imported transaction (many dates), not just the current
// cycle's handful, so the date-grouped ledger actually has several day headers to look at.
const SCREENS = [
  { path: '/', slug: 'dashboard', ready: (page) => page.getByTestId('income').waitFor() },
  { path: '/spend?cycle=all', slug: 'spend', ready: (page) => page.getByTestId('ledger-total').waitFor() },
  { path: '/spend/new', slug: 'spend-new', ready: (page) => page.locator('#amount').waitFor() },
  {
    path: '/settings',
    slug: 'settings',
    ready: async (page) => {
      await page.getByText('Groceries').waitFor()
      // The Account card shows "Loading…" while /api/me is in flight — wait for the real email
      // so the shot never catches that placeholder.
      await page.getByText(/@example\.test/).waitFor()
    },
  },
]
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }]
const SCHEMES = ['light', 'dark']

async function signIn(page, user, goPath) {
  await page.goto(baseURL + goPath)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function seed(browser, user) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await signIn(page, user, '/settings')
  await page.waitForURL(/\/settings$/)
  await page.locator('#import-file').setInputFiles('legacy/seed-data.json')
  await page.getByText(/Imported \d+ transactions/).waitFor()
  await page.close()
}

// Move the mouse away and drop focus before capturing an at-rest page, and wait past any ripple's
// ~300ms fade-out — otherwise the last click's pointer position / ripple / focus ring shows up.
async function settle(page) {
  await page.mouse.move(2, 2)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(450)
}

// Chromium logs this at `error` severity on every single page load here, purely because our CSP
// (scripts/vercel-headers.mjs) deliberately omits `script-src` and relies on the `default-src
// 'self'` fallback (verified correct in scripts/vercel-headers.test.ts) — it's advisory noise
// about that intentional policy shape, not a real page problem, so it's the one console message
// this script doesn't fail on.
const KNOWN_BENIGN_CONSOLE_TEXT = /'script-src' was not explicitly set/

let failed = false
function trackErrors(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !KNOWN_BENIGN_CONSOLE_TEXT.test(msg.text())) {
      failed = true
      console.error(`! console error on ${label}: ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => {
    failed = true
    console.error(`! page error on ${label}: ${err.message}`)
  })
}

async function shoot(browser, user, screen, viewport, colorScheme) {
  const label = `${screen.slug}-${viewport.width}-${colorScheme}`
  const page = await browser.newPage({ viewport, colorScheme })
  trackErrors(page, label)
  const routePath = screen.path.split('?')[0]
  await signIn(page, user, screen.path)
  await page.waitForURL(new RegExp(routePath.replace(/\//g, '\\/') + '(\\?.*)?$'))
  await screen.ready(page)
  await settle(page)
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (overflowX) console.warn(`! horizontal overflow at ${label}`)
  await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true })
  await page.close()
}

const user = await createTestUser('ui-screens')
try {
  const browser = await chromium.launch({ channel: 'chrome' })
  await seed(browser, user)
  for (const screen of SCREENS) {
    for (const viewport of VIEWPORTS) {
      for (const colorScheme of SCHEMES) {
        await shoot(browser, user, screen, viewport, colorScheme)
      }
    }
  }
  await browser.close()
} finally {
  // Cheap (a single admin DELETE) — always clean up, success or failure.
  await deleteTestUser(user.id)
}

if (failed) {
  console.error('ui:screens found console/page errors — see above; screenshots were still saved for inspection')
  process.exit(1)
}
console.log(`done — screenshots in ${outDir}`)
