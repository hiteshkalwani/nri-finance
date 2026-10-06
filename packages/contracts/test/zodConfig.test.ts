import { expect, test } from 'vitest'
import * as core from 'zod/v4/core'

// Finding 10: merely importing `@nri/contracts` must flip zod's global `jitless` flag before any
// of this package's `z.object()` schemas construct — and, because the probe this skips
// (`allowsEval`, `new Function('')`) is memoised process-wide on first access, this needs its own
// file: vitest isolates ESM module graphs per test file, so `allowsEval.value` is guaranteed
// fresh here and never touched before the assertions below (see zod's own
// jitless-allows-eval.test.ts, which this mirrors).
test('importing @nri/contracts sets jitless before constructing any schema, so the eval probe never runs', async () => {
  const origFunction = globalThis.Function
  let probeAttempted = false
  // @ts-expect-error stubbing the global Function constructor for the test
  globalThis.Function = function StubFunction(): never {
    probeAttempted = true
    throw new Error('allowsEval probe should have been skipped under jitless=true')
  }

  try {
    // Dynamic, not a static top-of-file import: a static import is hoisted and evaluated before
    // this test body runs at all, which would defeat the point of installing the spy first.
    await import('@nri/contracts')
    expect(core.globalConfig.jitless).toBe(true)
    expect(probeAttempted).toBe(false)
  } finally {
    globalThis.Function = origFunction
    delete core.globalConfig.jitless
  }
})

// The actual payoff of finding 10 is silencing a CSP console violation in the browser, but the
// point is moot if jitless mode broke parsing itself — contracts' own existing test suite already
// exercises plenty of real `.parse()`/`.safeParse()` calls (test/contracts.test.ts, test/m1.test.ts)
// against this same jitless-configured build, so a passing `pnpm test:unit` is itself evidence;
// this is one direct, explicit check of that alongside it.
test('parsing still works correctly under jitless (e.g. rejects a non-UUID categoryId)', async () => {
  const { Transaction } = await import('@nri/contracts')
  const valid = Transaction.safeParse({
    id: '11111111-1111-4111-8111-111111111111', occurredOn: '2026-10-05', cycle: '2026-10',
    categoryId: '22222222-2222-4222-8222-222222222222', accountId: null, description: 'Coffee',
    amountJpy: 450, enteredCurrency: 'JPY', amountInrPaise: null, rateUsed: null,
    paymentMethod: 'ic_card', needWant: 'want', notes: '',
  })
  expect(valid.success).toBe(true)

  const invalid = Transaction.safeParse({ ...valid.data, categoryId: 'not-a-uuid' })
  expect(invalid.success).toBe(false)
})
