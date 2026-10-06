import { z } from 'zod'

/**
 * Zod 4's `z.object()` eagerly probes `new Function('')` (its internal `allowsEval`, memoised on
 * first access) at schema-*construction* time, to decide whether it can JIT-compile a fast parser
 * for that schema. Under apps/web's CSP (no `script-src 'unsafe-eval'` — scripts/vercel-headers.mjs
 * relies on `default-src 'self'` with no `unsafe-eval`), the browser still reports that
 * caught-and-swallowed throw as a `securitypolicyviolation`/console error, even though the
 * exception never actually escapes zod. `jitless: true` skips the probe entirely — zod's own
 * regression test covers exactly this: zod/src/v4/classic/tests/jitless-allows-eval.test.ts — and
 * falls back to zod's plain interpreted parser: slower, not less correct.
 *
 * This must run before the *first* `z.object()` call anywhere `@nri/contracts` is used, in either
 * app (apps/web's browser bundle, where the CSP violation actually fires; apps/api's Node
 * process, where it's harmless but consistent) — `allowsEval.value` is memoised process-wide on
 * first access and never re-evaluated. Setting `z.config` from inside apps/web/src/main.ts isn't
 * early enough on its own: ES module evaluation runs every *imported* module's body before the
 * importing module's own top-level statements, so by the time any line in main.ts runs, every
 * transitively-imported schema file here (common.ts, categories.ts, …) has already constructed
 * its `z.object()` schemas and already triggered the probe. This file has no dependency but zod
 * itself, and index.ts imports it *before* any schema-defining submodule — so it's what actually
 * runs first, for every consumer of this package.
 */
z.config({ jitless: true })
