import { expect, it } from 'vitest'
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
