import { expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
}))
import { CategoryIcon } from '@nri/contracts'
import { activeCategories, CATEGORY_ICONS, moveId, PALETTE } from '../src/lib/categories'

it('moves an id up or down and ignores moves past either end', () => {
  expect(moveId(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  expect(moveId(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  expect(moveId(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
  expect(moveId(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
})

it('has 12 valid colours and hides archived categories from pickers', () => {
  expect(PALETTE).toHaveLength(12)
  for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  const cats = [{ id: '1', archived: false }, { id: '2', archived: true }] as never
  expect(activeCategories(cats).map((c: { id: string }) => c.id)).toEqual(['1'])
})

it('has 24 unique icons, each with a unique name, all passing the contracts CategoryIcon schema', () => {
  expect(CATEGORY_ICONS).toHaveLength(24)
  expect(new Set(CATEGORY_ICONS.map((o) => o.icon)).size).toBe(24)
  expect(new Set(CATEGORY_ICONS.map((o) => o.name)).size).toBe(24)
  for (const { icon, name } of CATEGORY_ICONS) {
    expect(CategoryIcon.safeParse(icon).success, `${name} (${icon}) should pass CategoryIcon`).toBe(true)
    expect(name.length).toBeGreaterThan(0)
  }
})
