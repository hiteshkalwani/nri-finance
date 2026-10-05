import type { NeedWant, PaymentMethod, SortField, Transaction, TransactionRestore } from '@nri/contracts'

export type LedgerState = {
  cycle: string | null
  categoryId: string | null
  paymentMethod: PaymentMethod | null
  needWant: NeedWant | null
  q: string
  sort: { key: SortField; order: 'asc' | 'desc' }
  page: number
}
type RouteQuery = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const KEYS = ['cycle', 'categoryId', 'paymentMethod', 'needWant', 'q', 'sort', 'dir', 'page'] as const
export const PAGE_SIZE = 50

/** The page URL is the source of truth for filters/sort/page (reload and back/forward keep them). */
export function toApiQuery(route: RouteQuery): URLSearchParams {
  const p = new URLSearchParams()
  for (const k of KEYS) if (str(route[k])) p.set(k, str(route[k]))
  p.set('pageSize', String(PAGE_SIZE))
  return p
}

export function sortFromRoute(route: RouteQuery): { key: SortField; order: 'asc' | 'desc' }[] {
  const key = (str(route.sort) || 'occurredOn') as SortField
  return [{ key, order: str(route.dir) === 'asc' ? 'asc' : 'desc' }]
}

export type SortValue = `${SortField}:asc` | `${SortField}:desc`

/** Friendly sort picker options, each mapped to a single `sort:dir` route value. */
export const SORT_OPTIONS: { title: string; value: SortValue }[] = [
  { title: 'Newest', value: 'occurredOn:desc' },
  { title: 'Oldest', value: 'occurredOn:asc' },
  { title: 'Amount high→low', value: 'amountJpy:desc' },
  { title: 'Amount low→high', value: 'amountJpy:asc' },
  { title: 'Category A→Z', value: 'category:asc' },
  { title: 'Description A→Z', value: 'description:asc' },
]

export function sortFromValue(v: SortValue | string): { key: SortField; order: 'asc' | 'desc' } {
  const [key, order] = v.split(':') as [SortField, 'asc' | 'desc']
  return { key, order }
}

/** The current sort as a single picker value, built on the same route reading as the table. */
export function sortValue(route: RouteQuery): SortValue {
  const { key, order } = sortFromRoute(route)[0]!
  return `${key}:${order}` as SortValue
}

/** The search box's value as the URL's `q` would show it (non-strings, e.g. undefined, read as ''). */
export function routeSearchValue(routeQ: unknown): string {
  return str(routeQ)
}

/** Vuetify's clearable × sets the search field's v-model to `null`; treat that like an empty box. */
export function coerceSearch(v: string | null | undefined): string {
  return v ?? ''
}

export function routeQueryFrom(s: LedgerState): Record<string, string> {
  const q: Record<string, string> = {}
  if (s.cycle) q.cycle = s.cycle
  if (s.categoryId) q.categoryId = s.categoryId
  if (s.paymentMethod) q.paymentMethod = s.paymentMethod
  if (s.needWant) q.needWant = s.needWant
  const search = coerceSearch(s.q).trim()
  if (search) q.q = search
  if (!(s.sort.key === 'occurredOn' && s.sort.order === 'desc')) { q.sort = s.sort.key; q.dir = s.sort.order }
  if (s.page > 1) q.page = String(s.page)
  return q
}

/** Undo after delete: re-create the row exactly as it was (TransactionRestore) — no ¥/₹ conversion, archived category OK. */
export function toRestoreInput(t: Transaction): TransactionRestore {
  return {
    occurredOn: t.occurredOn, categoryId: t.categoryId, accountId: t.accountId, description: t.description,
    notes: t.notes, paymentMethod: t.paymentMethod, needWant: t.needWant,
    amountJpy: t.amountJpy, enteredCurrency: t.enteredCurrency, amountInrPaise: t.amountInrPaise, rateUsed: t.rateUsed,
  }
}
