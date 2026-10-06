/** The user's theme choice: 'system' follows prefers-color-scheme (default); 'light'/'dark' override it. */
export type ThemePref = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'nri.theme'

/** Reads the stored preference. Falls back to 'system' for a missing/invalid value or an unavailable store
 * (private browsing, disabled storage, etc.) — never throws. */
export function loadThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Persists the preference for this device. Silently does nothing if storage is unavailable — the
 * in-memory preference for the current load still applies; it just won't survive a reload. */
export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // ignored — see above
  }
}

/** Turns a preference plus the current OS setting into a concrete Vuetify theme name. */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): 'light' | 'dark' {
  return pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref
}

/** The OS's current color-scheme preference, or false if matchMedia isn't available (e.g. in tests). */
export function prefersDarkNow(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}
