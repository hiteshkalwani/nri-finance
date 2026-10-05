import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadThemePref, resolveTheme, saveThemePref } from '../src/lib/themePref'

describe('resolveTheme', () => {
  it('follows the OS setting when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('returns an explicit light/dark preference unchanged, regardless of the OS setting', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('loadThemePref / saveThemePref', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('defaults to system when nothing is stored', () => {
    expect(loadThemePref()).toBe('system')
  })

  it('round-trips a saved preference', () => {
    saveThemePref('dark')
    expect(localStorage.getItem('nri.theme')).toBe('dark')
    expect(loadThemePref()).toBe('dark')
  })

  it('falls back to system for an invalid stored value', () => {
    localStorage.setItem('nri.theme', 'blue')
    expect(loadThemePref()).toBe('system')
  })

  it('falls back to system when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadThemePref()).toBe('system')
  })

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => saveThemePref('light')).not.toThrow()
  })
})
