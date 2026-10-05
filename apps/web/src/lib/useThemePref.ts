import { ref } from 'vue'
import { useTheme } from 'vuetify'
import { loadThemePref, prefersDarkNow, resolveTheme, saveThemePref, type ThemePref } from './themePref'

// A single shared preference for the whole app: the shell's toggle and Settings' Appearance
// control (Task 8) both read/write this same ref, so they always agree.
const pref = ref<ThemePref>(loadThemePref())

let systemListenerAttached = false
function ensureSystemListener(apply: () => void) {
  if (systemListenerAttached) return
  systemListenerAttached = true
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (pref.value === 'system') apply()
    })
  } catch {
    // matchMedia unavailable (e.g. older browsers) — the preference still works, it just won't
    // live-update while set to "system".
  }
}

/** Shared theme-preference state: the current choice, a setter, and a cycle (System → Light → Dark). */
export function useThemePref() {
  const theme = useTheme()
  const apply = () => { theme.global.name.value = resolveTheme(pref.value, prefersDarkNow()) }

  apply() // reflect the stored/system preference immediately — no flash of the wrong theme
  ensureSystemListener(apply)

  function setThemePref(next: ThemePref) {
    pref.value = next
    saveThemePref(next)
    apply()
  }

  function cycleThemePref() {
    setThemePref(pref.value === 'system' ? 'light' : pref.value === 'light' ? 'dark' : 'system')
  }

  return { pref, setThemePref, cycleThemePref }
}
