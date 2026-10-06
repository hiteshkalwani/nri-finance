import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

// Finding 8: before the Vue bundle loads (and resolves the stored/system theme — main.ts), the
// browser paints its own default canvas, which is light/white regardless of the OS's colour
// scheme — a visible light flash on an otherwise-dark page load. `color-scheme` tells the browser
// which native default to use for the as-yet-unstyled page (including its own default canvas
// background and form-control chrome), and the inline background below goes one step further:
// it matches this app's own actual light/dark canvas tokens (theme.ts), not just "a dark grey",
// so the pre-mount paint is close to the real theme rather than merely less wrong. Both read only
// `prefers-color-scheme` (the OS setting) — the stored per-user theme preference
// (localStorage, main.ts/lib/themePref.ts) needs JS to read at all, so it can only apply once the
// bundle has actually loaded; this is a best-effort guess for the instant before that.
it('sets color-scheme and a theme-matching pre-mount background in index.html', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8')

  expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/)

  const style = /<style>([\s\S]*?)<\/style>/.exec(html)
  expect(style, 'expected an inline <style> block in index.html').toBeTruthy()
  const css = style![1]!
  // Matches theme.ts's light/dark `background` tokens — kept in sync by eye (there's no shared
  // module between a plain HTML file and theme.ts to import from), not computed.
  expect(css).toMatch(/#f6f4f1/)
  expect(css).toMatch(/prefers-color-scheme:\s*dark/)
  expect(css).toMatch(/#141413/)
})
