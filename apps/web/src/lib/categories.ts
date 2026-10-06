import { useQuery } from '@tanstack/vue-query'
import { CategoryList, type Category } from '@nri/contracts'
import { apiFetch } from './api'

export const PALETTE = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4',
  '#795548', '#607d8b', '#f44336', '#3f51b5', '#8bc34a', '#ffc107',
]

/**
 * The icon menu's fixed 24-emoji set (spec §5), each with a human-readable name used as the
 * picker button's `aria-label` (e.g. "House", "Shopping cart") — a 6×4 grid plus "No icon"
 * (rendered separately by the caller). Every entry must pass the contracts' `CategoryIcon` schema
 * (1–8 UTF-16 units, at least one `\p{Extended_Pictographic}` character, no bare letters/digits) —
 * verified in test/categories.test.ts rather than assumed.
 */
export const CATEGORY_ICONS: { icon: string; name: string }[] = [
  { icon: '🏠', name: 'House' },
  { icon: '🛒', name: 'Shopping cart' },
  { icon: '🍜', name: 'Noodles' },
  { icon: '☕', name: 'Coffee' },
  { icon: '🚃', name: 'Train' },
  { icon: '🚕', name: 'Taxi' },
  { icon: '✈️', name: 'Airplane' },
  { icon: '💡', name: 'Light bulb' },
  { icon: '📱', name: 'Mobile phone' },
  { icon: '💊', name: 'Pill' },
  { icon: '🏥', name: 'Hospital' },
  { icon: '🛍️', name: 'Shopping bags' },
  { icon: '👕', name: 'T-shirt' },
  { icon: '🎁', name: 'Gift' },
  { icon: '🎬', name: 'Clapper board' },
  { icon: '🎮', name: 'Video game' },
  { icon: '📚', name: 'Books' },
  { icon: '🎓', name: 'Graduation cap' },
  { icon: '🐶', name: 'Dog face' },
  { icon: '💼', name: 'Briefcase' },
  { icon: '🧾', name: 'Receipt' },
  { icon: '💸', name: 'Money with wings' },
  { icon: '🏦', name: 'Bank' },
  { icon: '⭐', name: 'Star' },
]

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: async () => (await apiFetch('/api/categories', {}, CategoryList)).items })

export const activeCategories = (list: Category[]) => list.filter((c) => !c.archived)

/** New order after moving the id at `index` by `delta` (−1 up, +1 down); unchanged at the ends. */
export function moveId(ids: string[], index: number, delta: number): string[] {
  const to = index + delta
  if (to < 0 || to >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[to]] = [next[to]!, next[index]!]
  return next
}
