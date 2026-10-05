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

function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of a `#RRGGBB` colour; invalid input reads as black (luminance 0). */
function relativeLuminance(color: string): number {
  const hex = normalizeHex(color)
  if (!hex) return 0
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/**
 * WCAG contrast ratio between two `#RRGGBB` colours (1–21; the spec's text minimum is ≥4.5). Used
 * to verify theme colour pairings (e.g. a chip's text against its own tinted background) actually
 * meet spec §7, rather than eyeballing it.
 */
export function contrastRatio(colorA: string, colorB: string): number {
  const a = relativeLuminance(colorA)
  const b = relativeLuminance(colorB)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * `fgColor` painted at `alpha` over `bgColor` (e.g. a low-alpha tint over its actual surface), as
 * a solid `#RRGGBB` — what a viewer's eye (and `contrastRatio`) actually sees, since a translucent
 * fill's own contrast against the text sitting on it depends on what's behind it.
 */
export function flattenOver(fgColor: string, bgColor: string, alpha: number): string {
  const fg = normalizeHex(fgColor)
  const bg = normalizeHex(bgColor)
  if (!fg || !bg) return bgColor
  const channel = (i: number) => {
    const f = parseInt(fg.slice(1 + i * 2, 3 + i * 2), 16)
    const b = parseInt(bg.slice(1 + i * 2, 3 + i * 2), 16)
    return Math.round(b * (1 - alpha) + f * alpha)
  }
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`
}
