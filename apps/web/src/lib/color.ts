const HEX6 = /^#[0-9a-fA-F]{6}$/
const HEX3 = /^#[0-9a-fA-F]{3}$/
const NEUTRAL_TEXT = 'rgb(var(--v-theme-on-surface-variant))'
const NEUTRAL_TINT = 'rgba(var(--v-theme-on-surface-variant), 0.13)'

/**
 * `Category.color` is a bare `z.string()` on read (v1-imported colours pass through as stored —
 * packages/contracts/src/categories.ts), so it isn't guaranteed to be `#RRGGBB` CSS. Normalizes a
 * `#RGB`/`#RRGGBB` colour to 6 hex digits; anything else (a named colour, junk, empty) is not valid
 * CSS to tint/append alpha onto, so callers fall back to a neutral theme colour instead.
 */
function normalizeHex(color: string): string | null {
  if (HEX6.test(color)) return color
  if (HEX3.test(color)) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  return null
}

/** The colour itself for text/icon use, or a neutral theme colour when it isn't valid hex. */
export function safeColor(color: string): string {
  return normalizeHex(color) ?? NEUTRAL_TEXT
}

/** A low-alpha tint of the colour for a background fill, or a matching neutral tint when invalid. */
export function tint(color: string): string {
  const hex = normalizeHex(color)
  return hex ? `${hex}22` : NEUTRAL_TINT
}
