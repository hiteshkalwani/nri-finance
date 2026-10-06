import { expect, it } from 'vitest'
import { contrastRatio, flattenOver } from '../src/lib/color'
import { nriDark, nriLight, vuetifyOptions } from '../src/theme'

it('defines the light and dark palettes from the spec', () => {
  // `primary` in light theme is the deeper button-fill shade (task 8 contrast fix, below), not
  // the mockup's bright accent directly — that value now lives at `primary-accent`.
  expect(nriLight.colors).toMatchObject({ background: '#f6f4f1', surface: '#ffffff', primary: '#c2410c', 'primary-accent': '#f0682e', success: '#2f9a58', error: '#d64545' })
  expect(nriDark.colors).toMatchObject({ background: '#141413', surface: '#1d1c1a', primary: '#f58450', 'primary-accent': '#f58450' })
  expect(nriDark.dark).toBe(true)
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
