import { expect, it } from 'vitest'
import { activeCategories, moveId, PALETTE } from '../src/lib/categories'

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
