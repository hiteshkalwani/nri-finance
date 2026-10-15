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
  { path: '/accounts', slug: 'accounts', ready: (page) => page.getByTestId('net-worth-total').waitFor() },
  { path: '/accounts/balances', slug: 'balances', ready: (page) => page.getByTestId('cycle-label').waitFor() },
  { path: '/remit', slug: 'remit', ready: (page) => page.getByText('Sent this cycle').waitFor() },
  { path: '/remit/new', slug: 'remit-new', ready: (page) => page.locator('#jpySent').waitFor() },
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

// cycleOf/previousCycle, inlined (not imported from @nri/core): this script runs under plain
// `node`, and only @nri/test-utils is a root devDependency — pulling in @nri/core just for two
// tiny date functions isn't worth a new workspace dependency. Matches packages/core/src/cycles.ts.
function cycleOfTokyo(dateIso, startDay) {
  const [y, m, d] = dateIso.split('-').map(Number)
  let year = y
  let month = m
  if (d >= startDay) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return `${year}-${String(month).padStart(2, '0')}`
}
function previousCycle(cycle) {
  const [y, m] = cycle.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
function todayIsoTokyo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function apiCall(token, path, init = {}) {
  const res = await fetch(baseURL + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// The v1 import (seed()) only creates the 3 "starter" accounts (Japan bank, Japan emergency fund,
// India bank — apps/api/src/services/importV1.ts). Adds one more account per the brief (an India
// FD, a Japan credit card) and two cycles of balances so the Accounts screen's chart, change
// figures and summary aren't empty.
async function seedAccountsAndBalances(user) {
  const { items } = await apiCall(user.accessToken, '/api/accounts?include=archived')
  const byName = new Map(items.map((a) => [a.name, a]))
  const indiaFd = await apiCall(user.accessToken, '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'India fixed deposit', country: 'IN', type: 'fd' }) })
  const japanCard = await apiCall(user.accessToken, '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'Japan credit card', country: 'JP', type: 'card' }) })
  const jpBank = byName.get('Japan bank')
  const jpEf = byName.get('Japan emergency fund')
  const inBank = byName.get('India bank')

  // The v1 import sets cycleStartDay to 25 (legacy/seed-data.json's settings.cycleStartDay).
  const thisCycle = cycleOfTokyo(todayIsoTokyo(), 25)
  const prevCycle = previousCycle(thisCycle)
  const entriesFor = (amounts) => [
    { accountId: jpBank.id, amount: amounts.jpBank },
    { accountId: jpEf.id, amount: amounts.jpEf },
    { accountId: japanCard.id, amount: amounts.card },
    { accountId: inBank.id, amount: amounts.inBank }, // paise
    { accountId: indiaFd.id, amount: amounts.inFd }, // paise
  ]
  await apiCall(user.accessToken, '/api/balances', {
    method: 'PUT',
    body: JSON.stringify({ cycle: prevCycle, entries: entriesFor({ jpBank: 1180000, jpEf: 1960000, card: 28000, inBank: 38000000, inFd: 100000000 }) }),
  })
  await apiCall(user.accessToken, '/api/balances', {
    method: 'PUT',
    body: JSON.stringify({ cycle: thisCycle, entries: entriesFor({ jpBank: 1240000, jpEf: 2000000, card: 31000, inBank: 40000000, inFd: 100000000 }) }),
  })
}

// The v1 import's two 'family-india' rows (seed-data.json) both land in an August cycle, so
// /remit's default (current-cycle) view would otherwise show "no transfers yet" — adds one
// current-cycle transfer so the KPIs, purpose breakdown and rate chart all have something to show.
async function seedRemittance(user) {
  const { items } = await apiCall(user.accessToken, '/api/accounts?include=archived')
  const byName = new Map(items.map((a) => [a.name, a]))
  await apiCall(user.accessToken, '/api/remittances', {
    method: 'POST',
    body: JSON.stringify({
      sentOn: todayIsoTokyo(), jpySent: 85000, inrPaise: 5000000, feeJpy: 500, service: 'wise',
      fromAccountId: byName.get('Japan bank').id, toAccountId: byName.get('India bank').id,
      purpose: 'family', loanId: null, notes: '',
    }),
  })
}

// Move the mouse away and drop focus before capturing an at-rest page, and wait past any ripple's
// ~300ms fade-out — otherwise the last click's pointer position / ripple / focus ring shows up.
async function settle(page) {
  await page.mouse.move(2, 2)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(450)
}

// Used to unconditionally exclude every console message mentioning 'script-src' — that was meant
// to cover one specific, genuinely benign message (zod 4's `allowsEval` feature probe, `new
// Function('')`, blocked under our CSP's lack of `unsafe-eval`; the violation report's own text
// happens to note that `script-src` falls back to `default-src` here), but matched *any*
// script-related CSP violation, benign or not. `@nri/contracts` (packages/contracts/src/zodConfig.ts)
// now sets `z.config({ jitless: true })` before any schema is constructed, which skips that probe
// entirely — so there's nothing left here to carve out, and a real script-src violation (CSP
// misconfigured some other way) now correctly fails this script instead of being silently eaten.
let failed = false
function trackErrors(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
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
  // `reducedMotion: 'reduce'` (fix round 1): Chart.js's default ~1s draw-in animation on the
  // Accounts net worth chart raced `settle()`'s 450ms wait — the app's own `NetWorthChart.vue`
  // checks `prefers-reduced-motion` and skips the animation when it matches, so the chart renders
  // complete immediately instead of mid-animation (or, on a slow run, still empty).
  const page = await browser.newPage({ viewport, colorScheme, reducedMotion: 'reduce' })
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

// Task 8's acceptance check: the sticky footer must sit above the phone bottom nav and never
// cover the last field. A `fullPage: true` shot (what `shoot()` takes) can't show that — it
// captures the whole scrollable document flattened out, not what's actually pinned on screen
// after scrolling — so this is a second, viewport-only screenshot taken after scrolling all the
// way down.
async function shootBalancesScrolledToBottom(browser, user) {
  const label = 'balances-390-scrolled-bottom'
  const viewport = { width: 390, height: 844 }
  const page = await browser.newPage({ viewport, colorScheme: 'light', reducedMotion: 'reduce' })
  trackErrors(page, label)
  await signIn(page, user, '/accounts/balances')
  await page.waitForURL(/\/accounts\/balances(\?.*)?$/)
  await page.getByTestId('cycle-label').waitFor()
  await settle(page)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: false })
  await page.close()
}

const user = await createTestUser('ui-screens')
let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
  await seed(browser, user)
  await seedAccountsAndBalances(user)
  await seedRemittance(user)
  for (const screen of SCREENS) {
    for (const viewport of VIEWPORTS) {
      for (const colorScheme of SCHEMES) {
        await shoot(browser, user, screen, viewport, colorScheme)
      }
    }
  }
  await shootBalancesScrolledToBottom(browser, user)
} finally {
  // Both cleanups always run, success or failure — `browser.close()` used to be the last
  // statement of the try block, so an error anywhere above it (seed, or any one shot) leaked the
  // browser process for the rest of the run.
  await browser?.close()
  // Cheap (a single admin DELETE) — always clean up, success or failure.
  await deleteTestUser(user.id)
}

if (failed) {
  console.error('ui:screens found console/page errors — see above; screenshots were still saved for inspection')
  process.exit(1)
}
console.log(`done — screenshots in ${outDir}`)
