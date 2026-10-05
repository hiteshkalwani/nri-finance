import { expect, it } from 'vitest'
import { contrastRatio, flattenOver } from '../src/lib/color'
import { nriDark, nriLight, vuetifyOptions } from '../src/theme'

it('defines the light and dark palettes from the spec', () => {
  expect(nriLight.colors).toMatchObject({ background: '#f6f4f1', surface: '#ffffff', primary: '#f0682e', success: '#2f9a58', error: '#d64545' })
  expect(nriDark.colors).toMatchObject({ background: '#141413', surface: '#1d1c1a', primary: '#f58450' })
  expect(nriDark.dark).toBe(true)
})

it('follows the system theme and sets the component defaults', () => {
  expect(vuetifyOptions.theme.defaultTheme).toBe('system')
  expect(vuetifyOptions.defaults.VBtn).toMatchObject({ rounded: 'lg' })
  expect(vuetifyOptions.defaults.VTextField).toMatchObject({ variant: 'outlined' })
})

// Fix round 2: ExpenseRow's "Want" chip paints `primary-darken-1` text on a 12%-alpha tint of
// `primary` over the row's actual background — verify that pairing clears spec §7's 4.5:1 text
// minimum in both themes, both at rest (surface) and on hover (surface-variant), rather than
// trusting a hand calculation. `primary` itself fails this in light theme (checked below too, as
// the documented reason `primary-darken-1` exists).
it('keeps the "Want" chip text at >=4.5:1 contrast against its own tint, both themes, rest and hover (spec §7)', () => {
  const wantContrast = (theme: typeof nriLight) => {
    const colors = theme.colors!
    const primary = colors.primary as string
    const text = colors['primary-darken-1'] as string
    const rest = flattenOver(primary, colors.surface as string, 0.12)
    const hover = flattenOver(primary, colors['surface-variant'] as string, 0.12)
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
  const primaryOnly = (theme: typeof nriLight) => {
    const colors = theme.colors!
    const primary = colors.primary as string
    const rest = flattenOver(primary, colors.surface as string, 0.12)
    const hover = flattenOver(primary, colors['surface-variant'] as string, 0.12)
    return { rest: contrastRatio(primary, rest), hover: contrastRatio(primary, hover) }
  }
  expect(primaryOnly(nriLight).rest).toBeLessThan(4.5)
  expect(primaryOnly(nriLight).hover).toBeLessThan(4.5)
})
