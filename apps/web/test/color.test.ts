import { describe, expect, it } from 'vitest'
import { safeColor, tint } from '../src/lib/color'

describe('safeColor', () => {
  it('passes through a valid 6-digit hex colour', () => {
    expect(safeColor('#f0682e')).toBe('#f0682e')
  })
  it('expands a valid 3-digit hex colour', () => {
    expect(safeColor('#abc')).toBe('#aabbcc')
  })
  it('falls back to a neutral theme colour for junk input', () => {
    expect(safeColor('not-a-colour')).toBe('rgb(var(--v-theme-on-surface-variant))')
    expect(safeColor('red')).toBe('rgb(var(--v-theme-on-surface-variant))')
  })
  it('falls back to a neutral theme colour for an empty string', () => {
    expect(safeColor('')).toBe('rgb(var(--v-theme-on-surface-variant))')
  })
})

describe('tint', () => {
  it('appends the alpha hex to a valid 6-digit colour', () => {
    expect(tint('#f0682e')).toBe('#f0682e22')
  })
  it('expands a 3-digit colour before tinting', () => {
    expect(tint('#abc')).toBe('#aabbcc22')
  })
  it('falls back to a neutral low-alpha tint for junk input', () => {
    expect(tint('not-a-colour')).toBe('rgba(var(--v-theme-on-surface-variant), 0.13)')
  })
  it('falls back to a neutral low-alpha tint for an empty string', () => {
    expect(tint('')).toBe('rgba(var(--v-theme-on-surface-variant), 0.13)')
  })
})
