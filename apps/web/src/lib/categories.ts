import { useQuery } from '@tanstack/vue-query'
import { CategoryList, type Category } from '@nri/contracts'
import { apiFetch } from './api'

export const PALETTE = [
  '#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4',
  '#795548', '#607d8b', '#f44336', '#3f51b5', '#8bc34a', '#ffc107',
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
