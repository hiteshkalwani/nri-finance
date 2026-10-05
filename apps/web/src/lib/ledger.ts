import type { NeedWant, PaymentMethod, SortField, Transaction, TransactionCreate } from '@nri/contracts'

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

/** The search box's value as the URL's `q` would show it (non-strings, e.g. undefined, read as ''). */
export function routeSearchValue(routeQ: unknown): string {
  return str(routeQ)
}

export function routeQueryFrom(s: LedgerState): Record<string, string> {
  const q: Record<string, string> = {}
  if (s.cycle) q.cycle = s.cycle
  if (s.categoryId) q.categoryId = s.categoryId
  if (s.paymentMethod) q.paymentMethod = s.paymentMethod
  if (s.needWant) q.needWant = s.needWant
  if (s.q.trim()) q.q = s.q.trim()
  if (!(s.sort.key === 'occurredOn' && s.sort.order === 'desc')) { q.sort = s.sort.key; q.dir = s.sort.order }
  if (s.page > 1) q.page = String(s.page)
  return q
}

/** Undo after delete: re-create from the copy kept client-side, in the currency it was entered in. */
export function toCreateInput(t: Transaction): TransactionCreate {
  const common = {
    occurredOn: t.occurredOn, categoryId: t.categoryId, accountId: t.accountId, description: t.description,
    notes: t.notes, paymentMethod: t.paymentMethod, needWant: t.needWant,
  }
  return t.enteredCurrency === 'INR' && t.amountInrPaise !== null ? { ...common, amountInrPaise: t.amountInrPaise } : { ...common, amountJpy: t.amountJpy }
}
