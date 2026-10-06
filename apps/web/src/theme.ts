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
    // `success`/`error`/`secondary`/`info` mirror the `primary`/`primary-accent` split above
    // (finding 2, fix round 3): the mockup's bright originals (#2f9a58/#d64545/#1683b8) measured
    // 3.57:1 / 4.38:1 (3.73:1 on their own tonal tint) / 4.22:1 on white — all under spec §7's
    // 4.5:1 text minimum, yet these tokens are painted as *text* everywhere Vuetify uses them by
    // default (`.text-success`/`.text-error`, a tonal alert's or tonal button's text, a filled
    // snackbar's text). Deepened here (same hue) to clear 4.5:1 on white, on the page canvas, and
    // on their own 12%-tonal tint over either (verified in theme.test.ts); `secondary` and `info`
    // share one value, as the mockup's single link-blue. The bright originals survive at
    // `success-accent`/`error-accent` below, for the one place that paints them as a non-text fill
    // (the savings-rate mini-bar) rather than text.
    secondary: '#116791', success: '#226f3f', error: '#a13434', warning: '#a56a00', info: '#116791',
    'success-accent': '#2f9a58', 'error-accent': '#d64545',
    // Explicit, not Vuetify's auto-derived `on-<color>` (same reasoning as `on-primary` below):
    // white clears 4.5:1 against every deepened value above (6+:1, theme.test.ts).
    'on-success': '#ffffff', 'on-error': '#ffffff', 'on-secondary': '#ffffff', 'on-info': '#ffffff',
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
    // Same reasoning as `primary` above: dark theme's success/error/link were already light
    // enough to clear 4.5:1 as text against every backdrop the app uses (canvas, surface, and
    // their own 12%-tonal tint over either — verified in theme.test.ts), so no darkening needed —
    // `success-accent`/`error-accent` are set to the same value as `success`/`error`, same as
    // `primary-accent` above, purely so the token still resolves for CSS that explicitly asks for
    // the non-text accent regardless of theme.
    secondary: '#5fb6e0', success: '#5cc787', error: '#f07070', warning: '#f0c060', info: '#5fb6e0',
    'success-accent': '#5cc787', 'error-accent': '#f07070',
    // Explicit, not auto-derived: these light pastel colours need *dark* text, unlike light
    // theme's deep shades above (needing white) — e.g. the restore-error snackbar's filled
    // background. Clears 4.5:1 (5.8+:1, theme.test.ts).
    'on-success': '#1d1d1f', 'on-error': '#1d1d1f', 'on-secondary': '#1d1d1f', 'on-info': '#1d1d1f',
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
