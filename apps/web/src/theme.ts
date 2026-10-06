import type { ThemeDefinition } from 'vuetify'

// Palette from docs/superpowers/specs/2026-10-05-ui-refresh-design.md §2 and
// docs/diagrams/nri-ui-mockup.html's :root custom properties.
export const nriLight: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#f6f4f1', surface: '#ffffff', 'surface-variant': '#efece7', 'on-surface-variant': '#1d1d1f',
    // `primary` is deliberately *not* the bright mockup accent: Vuetify paints every filled
    // `color="primary"` surface (Save/Add expense/Sign in buttons, the bottom-nav "+", the brand
    // mark) with `primary` text in white, and white-on-the-old-bright-accent (#f0682e) only hit
    // 3.12:1 — under spec §7's 4.5:1 minimum (controller ruling, task 8). This deeper shade of the
    // same hue clears it (5.18:1 with white, verified in theme.test.ts) without having to touch
    // every button call site. The bright accent itself survives as `primary-accent` below, for the
    // non-text uses (bars, chart highlights, selection rings, focus rings) that must stay bright.
    primary: '#c2410c', 'on-primary': '#ffffff',
    // The mockup's actual accent — bright/light, so unsuitable for text-on-fill (see `primary`
    // above) but correct for anything that *isn't* painting text onto itself: the spend-per-cycle
    // bars, the ¥/₹ and category-tile selection rings, and the global focus ring.
    'primary-accent': '#f0682e',
    secondary: '#1683b8', success: '#2f9a58', error: '#d64545', warning: '#a56a00', info: '#1683b8',
    'on-background': '#1d1d1f', 'on-surface': '#1d1d1f',
    // A darker shade of `primary-accent`, same hue/saturation, for text that sits on a *tint* of
    // primary-accent (e.g. ExpenseRow's "Want" chip) — the bright accent itself fails WCAG's 4.5:1
    // text-contrast minimum (spec §7) against its own light-theme tint (2.74:1 rest / 2.36:1
    // hover); this value measures 5.90:1 / 5.06:1 (verified in theme.test.ts, not just eyeballed).
    'primary-darken-1': '#a2390c',
  },
  variables: { 'border-color': '#ebe7e1', 'border-opacity': 1, 'medium-emphasis-opacity': 0.72 },
}

export const nriDark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#141413', surface: '#1d1c1a', 'surface-variant': '#2a2825', 'on-surface-variant': '#efece6',
    // Unlike light theme, dark theme's bright accent is *already* light enough to carry dark text
    // cleanly (6.65:1, verified in theme.test.ts) — so `primary` stays the bright accent here and
    // only `on-primary` needs to change (from white, 2.53:1, to dark text). No separate
    // `primary-accent` value is needed; it's set to the same colour for the token to still resolve
    // for any CSS that explicitly asks for the non-text accent regardless of theme.
    primary: '#f58450', 'on-primary': '#1d1d1f', 'primary-accent': '#f58450',
    secondary: '#5fb6e0', success: '#5cc787', error: '#f07070', warning: '#f0c060', info: '#5fb6e0',
    'on-background': '#efece6', 'on-surface': '#efece6',
    // Dark theme's `primary` already clears 4.5:1 against its own tint (5.56:1 rest / 4.76:1
    // hover) — no darkening needed, so this is the same value as `primary` here.
    'primary-darken-1': '#f58450',
  },
  variables: { 'border-color': '#2e2c29', 'border-opacity': 1, 'medium-emphasis-opacity': 0.72 },
}

// Vuetify 4.2's createTheme natively supports defaultTheme: 'system': it reads
// window.matchMedia('(prefers-color-scheme: dark)') on init and subscribes to its
// 'change' event (node_modules/vuetify/lib/composables/theme.js), so light/dark follows
// the OS setting live with no extra listener code needed here.
export const vuetifyOptions = {
  theme: { defaultTheme: 'system', themes: { light: nriLight, dark: nriDark } },
  defaults: {
    VCard: { flat: true, border: true, rounded: 'lg' },
    VBtn: { rounded: 'lg', class: 'text-none', variant: 'flat' },
    VTextField: { variant: 'outlined', density: 'comfortable' },
    VSelect: { variant: 'outlined', density: 'comfortable' },
    VTextarea: { variant: 'outlined', density: 'comfortable' },
    VChip: { rounded: 'pill' },
  },
}
