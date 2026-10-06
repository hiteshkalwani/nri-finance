import { expect, it } from 'vitest'
import { contrastRatio, flattenOver } from '../src/lib/color'
import { nriDark, nriLight, vuetifyOptions } from '../src/theme'

it('defines the light and dark palettes from the spec', () => {
  // `primary` in light theme is the deeper button-fill shade (task 8 contrast fix, below), not
  // the mockup's bright accent directly — that value now lives at `primary-accent`. Likewise
  // (finding 2 contrast fix, below): `success`/`error` in light theme are deepened text-safe
  // shades, with the mockup's bright originals surviving at `success-accent`/`error-accent`.
  expect(nriLight.colors).toMatchObject({
    background: '#f6f4f1', surface: '#ffffff', primary: '#c2410c', 'primary-accent': '#f0682e',
    success: '#226f3f', 'success-accent': '#2f9a58', error: '#a13434', 'error-accent': '#d64545',
    secondary: '#116791', info: '#116791',
  })
  expect(nriDark.colors).toMatchObject({
    background: '#141413', surface: '#1d1c1a', primary: '#f58450', 'primary-accent': '#f58450',
    success: '#5cc787', 'success-accent': '#5cc787', error: '#f07070', 'error-accent': '#f07070',
  })
  expect(nriDark.dark).toBe(true)
})

// Finding 2: light theme's success/error/link(secondary+info) text failed spec §7's 4.5:1 text
// minimum — success #2f9a58 (3.57 on white), link #1683b8 (4.22 on white), error #d64545 (4.38 on
// white, 3.73 on its own tonal tint). Mirrors the primary/primary-accent split (task 8): the
// token itself is now the deepened, text-safe shade (used automatically wherever Vuetify paints
// `success`/`error`/`secondary`/`info` as text — `.text-success`, `v-alert`'s tonal text, a tonal
// button's text, a filled snackbar's `on-error` text), and the bright mockup originals survive at
// `success-accent`/`error-accent` for the few places that paint them as a non-text fill (the
// savings-rate mini-bar) rather than text.
it('keeps success/error/link text at >=4.5:1 on white, on the page canvas, and on their own tonal tint (spec §7), in both themes', () => {
  const canvasOf = (theme: typeof nriLight) => theme.colors!.background as string
  const surfaceOf = (theme: typeof nriLight) => theme.colors!.surface as string

  for (const theme of [nriLight, nriDark]) {
    const canvas = canvasOf(theme)
    const surface = surfaceOf(theme)
    for (const key of ['success', 'error', 'secondary', 'info'] as const) {
      const text = theme.colors![key] as string
      // "On white" only matters for light theme, where white (`surface`) is an actual backdrop
      // these colours sit on; dark theme's own light pastel values are read against its *dark*
      // canvas/surface instead (checked below), never against white.
      if (!theme.dark) expect(contrastRatio(text, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(text, canvas)).toBeGreaterThanOrEqual(4.5)
      // The 12%-alpha tonal tint Vuetify's `tonal` variant paints behind this same text colour
      // (vuetify/lib/composables/theme.js's `activated-opacity` default), over each backdrop the
      // app actually places one on.
      expect(contrastRatio(text, flattenOver(text, surface, 0.12))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(text, flattenOver(text, canvas, 0.12))).toBeGreaterThanOrEqual(4.5)
    }
    // Edit's tonal Delete button is interactive (hover adds Vuetify's own hover-opacity on top of
    // the tonal tint, deepening it further) — error must clear 4.5:1 even at that hover alpha.
    const error = theme.colors!.error as string
    expect(contrastRatio(error, flattenOver(error, canvas, 0.16))).toBeGreaterThanOrEqual(4.5)
  }

  // The bright mockup originals this replaced, as text — documents *why* the accent tokens exist.
  expect(contrastRatio(nriLight.colors!['success-accent'] as string, '#ffffff')).toBeLessThan(4.5)
  expect(contrastRatio(nriLight.colors!['error-accent'] as string, flattenOver(nriLight.colors!['error-accent'] as string, nriLight.colors!.surface as string, 0.12))).toBeLessThan(4.5)
})

// The savings-rate mini-bar (DashboardPage.vue) is a non-text fill, like the bars/rings `primary-
// accent` already covers — it must keep painting the bright mockup colour, not the deepened text
// shade, in both themes.
it('keeps success-accent/error-accent at the bright mockup colour (non-text fills), same value as success/error where dark theme never needed to deepen them', () => {
  expect(nriLight.colors!['success-accent']).toBe('#2f9a58')
  expect(nriLight.colors!['error-accent']).toBe('#d64545')
  expect(nriDark.colors!['success-accent']).toBe(nriDark.colors!.success)
  expect(nriDark.colors!['error-accent']).toBe(nriDark.colors!.error)
})

// Every filled/snackbar use of success/error/secondary/info relies on Vuetify auto-deriving
// `on-<color>` when it isn't set explicitly — an APCA-based heuristic the project doesn't trust
// for WCAG compliance (see task 8's `on-primary` comment in theme.ts). Pin it explicitly instead,
// same as `on-primary`, and verify it actually clears 4.5:1 against its own token.
it('sets explicit on-success/on-error/on-secondary/on-info that clear 4.5:1 against their own colour, in both themes', () => {
  for (const theme of [nriLight, nriDark]) {
    for (const key of ['success', 'error', 'secondary', 'info'] as const) {
      const on = theme.colors![`on-${key}`] as string | undefined
      expect(on).toBeTruthy()
      expect(contrastRatio(on!, theme.colors![key] as string)).toBeGreaterThanOrEqual(4.5)
    }
  }
})

it('follows the system theme and sets the component defaults', () => {
  expect(vuetifyOptions.theme.defaultTheme).toBe('system')
  expect(vuetifyOptions.defaults.VBtn).toMatchObject({ rounded: 'lg' })
  expect(vuetifyOptions.defaults.VTextField).toMatchObject({ variant: 'outlined' })
})

// Fix round 2: ExpenseRow's "Want" chip paints `primary-darken-1` text on a 12%-alpha tint of
// `primary-accent` over the row's actual background — verify that pairing clears spec §7's 4.5:1
// text minimum in both themes, both at rest (surface) and on hover (surface-variant), rather than
// trusting a hand calculation. `primary-accent` itself fails this in light theme (checked below
// too, as the documented reason `primary-darken-1` exists).
it('keeps the "Want" chip text at >=4.5:1 contrast against its own tint, both themes, rest and hover (spec §7)', () => {
  const wantContrast = (theme: typeof nriLight) => {
    const colors = theme.colors!
    const accent = colors['primary-accent'] as string
    const text = colors['primary-darken-1'] as string
    const rest = flattenOver(accent, colors.surface as string, 0.12)
    const hover = flattenOver(accent, colors['surface-variant'] as string, 0.12)
    return { rest: contrastRatio(text, rest), hover: contrastRatio(text, hover) }
  }
  const light = wantContrast(nriLight)
  const dark = wantContrast(nriDark)
  expect(light.rest).toBeGreaterThanOrEqual(4.5)
  expect(light.hover).toBeGreaterThanOrEqual(4.5)
  expect(dark.rest).toBeGreaterThanOrEqual(4.5)
  expect(dark.hover).toBeGreaterThanOrEqual(4.5)

  // The bright accent itself (what the chip used before this fix) still fails in light theme —
  // documents *why* `primary-darken-1` exists, so this doesn't silently stop being true.
  const accentOnly = (theme: typeof nriLight) => {
    const colors = theme.colors!
    const accent = colors['primary-accent'] as string
    const rest = flattenOver(accent, colors.surface as string, 0.12)
    const hover = flattenOver(accent, colors['surface-variant'] as string, 0.12)
    return { rest: contrastRatio(accent, rest), hover: contrastRatio(accent, hover) }
  }
  expect(accentOnly(nriLight).rest).toBeLessThan(4.5)
  expect(accentOnly(nriLight).hover).toBeLessThan(4.5)
})

// Task 8 (controller ruling): every filled `color="primary"` surface (Save/Add expense/Sign in
// buttons, the bottom-nav "+", the brand mark) paints `on-primary` text straight onto `primary` —
// verify that pairing clears spec §7's 4.5:1 minimum in both themes, and that it's actually an
// improvement over the bright accent these used to paint white text onto directly.
it('keeps filled primary surfaces (buttons, the bottom-nav "+", the brand mark) at >=4.5:1 contrast in both themes (spec §7)', () => {
  const onPrimary = (theme: typeof nriLight) => {
    const colors = theme.colors!
    return contrastRatio(colors['on-primary'] as string, colors.primary as string)
  }
  expect(onPrimary(nriLight)).toBeGreaterThanOrEqual(4.5)
  expect(onPrimary(nriDark)).toBeGreaterThanOrEqual(4.5)

  // Documents *why* `primary` changed in light theme: white straight on the old bright accent
  // (`primary-accent`) still fails there, and dark theme's old white-on-`primary` pairing fails too.
  expect(contrastRatio('#ffffff', nriLight.colors!['primary-accent'] as string)).toBeLessThan(4.5)
  expect(contrastRatio('#ffffff', nriDark.colors!.primary as string)).toBeLessThan(4.5)
})

// Fix round 1 (task 7): the quick-add/edit ¥/₹ segmented toggle's selected button painted white
// text directly on `primary` — measured 3.12:1 light, 2.53:1 dark, both under spec §7's 4.5:1
// minimum (`primary` was a bright/light accent in both themes then). QuickAddPage.vue/
// EditTransactionPage.vue now use `primary-darken-1` + white in light, and (task 8) the theme's
// own `on-primary` token in dark, where `primary` is already light enough to read dark text.
it('keeps the selected ¥/₹ segment at >=4.5:1 contrast in both themes (spec §7)', () => {
  // The pairing this fix replaced — documents *why* it was replaced. (Light theme's `primary` is
  // now the deeper button-fill shade from task 8, so the pre-fix bright accent it refers to is
  // `primary-accent` there.)
  expect(contrastRatio('#ffffff', nriLight.colors!['primary-accent'] as string)).toBeLessThan(4.5)
  expect(contrastRatio('#ffffff', nriDark.colors!.primary as string)).toBeLessThan(4.5)

  expect(contrastRatio('#ffffff', nriLight.colors!['primary-darken-1'] as string)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(nriDark.colors!['on-primary'] as string, nriDark.colors!.primary as string)).toBeGreaterThanOrEqual(4.5)
})

// Fix round 1, item 3: the global `:focus-visible` ring (app.css) used `primary-accent` — a
// non-text use, so spec §7's 4.5:1 text minimum doesn't apply, but WCAG 1.4.11 (non-text
// contrast) requires >=3:1 against the ring's surroundings, and light theme's `primary-accent`
// (#f0682e) only clears 2.84:1 against the page background and 3.12:1 against a card surface —
// the first fails outright. Switched the global ring to `primary` (the deeper #c2410c from the
// task 8 button-contrast fix), which clears both. Dark theme's `primary` was never darkened and
// already cleared both, so it's unchanged.
it('keeps the global focus ring at >=3:1 contrast against both the background and a surface (WCAG 1.4.11)', () => {
  const ringContrast = (theme: typeof nriLight) => {
    const colors = theme.colors!
    return {
      bg: contrastRatio(colors.primary as string, colors.background as string),
      surface: contrastRatio(colors.primary as string, colors.surface as string),
    }
  }
  const light = ringContrast(nriLight)
  const dark = ringContrast(nriDark)
  expect(light.bg).toBeGreaterThanOrEqual(3)
  expect(light.surface).toBeGreaterThanOrEqual(3)
  expect(dark.bg).toBeGreaterThanOrEqual(3)
  expect(dark.surface).toBeGreaterThanOrEqual(3)

  // The ring this replaced in light theme — documents *why* `primary-accent` wasn't kept here.
  expect(contrastRatio(nriLight.colors!['primary-accent'] as string, nriLight.colors!.background as string)).toBeLessThan(3)
})

// Finding 7: ExpenseRow's own focus ring (a separate rule from the global one above, since it
// sits inside a `v-card` that clips an outside-offset ring) used `primary-accent`, which only
// clears 2.65:1 against the row's hover fill (`surface-variant`) in light theme — under WCAG
// 1.4.11's 3:1 non-text minimum. `primary` (the same token the global ring uses) must clear it
// against both the row's resting background (`surface`) and its hover fill (`surface-variant`),
// in both themes.
it('keeps ExpenseRow\'s own focus ring at >=3:1 against the row background and its hover fill, in both themes (WCAG 1.4.11)', () => {
  const ringContrast = (theme: typeof nriLight) => {
    const colors = theme.colors!
    return {
      rest: contrastRatio(colors.primary as string, colors.surface as string),
      hover: contrastRatio(colors.primary as string, colors['surface-variant'] as string),
    }
  }
  const light = ringContrast(nriLight)
  const dark = ringContrast(nriDark)
  expect(light.rest).toBeGreaterThanOrEqual(3)
  expect(light.hover).toBeGreaterThanOrEqual(3)
  expect(dark.rest).toBeGreaterThanOrEqual(3)
  expect(dark.hover).toBeGreaterThanOrEqual(3)

  // The ring this replaced — documents *why* `primary-accent` wasn't kept here either.
  expect(contrastRatio(nriLight.colors!['primary-accent'] as string, nriLight.colors!['surface-variant'] as string)).toBeLessThan(3)
})
