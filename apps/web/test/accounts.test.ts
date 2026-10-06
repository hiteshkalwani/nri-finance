import { afterEach, expect, it, vi } from 'vitest'
import { groupByType, inOtherCurrency, loadShowIn, netWorthChangeDisplay, saveShowIn } from '../src/lib/accounts'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

it('groups rows by TYPE_ORDER (Bank, Cash, FD, Investment, Cards), each group sorted by name, dropping types with no rows', () => {
  const rows = [
    { name: 'Zeta card', type: 'card' as const },
    { name: 'Alpha bank', type: 'bank' as const },
    { name: 'Beta bank', type: 'bank' as const },
  ]
  const groups = groupByType(rows)
  expect(groups.map((g) => g.type)).toEqual(['bank', 'card'])
  expect(groups[0]!.label).toBe('Bank')
  expect(groups[0]!.rows.map((r) => r.name)).toEqual(['Alpha bank', 'Beta bank'])
  expect(groups[1]!.rows.map((r) => r.name)).toEqual(['Zeta card'])
})

it('loads the remembered "In ¥ / In ₹" choice, falling back to JPY when storage is empty, holds junk, or throws', () => {
  expect(loadShowIn()).toBe('JPY')
  saveShowIn('INR')
  expect(loadShowIn()).toBe('INR')
  localStorage.setItem('nri.accounts.showIn', 'nonsense')
  expect(loadShowIn()).toBe('JPY')

  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(loadShowIn()).toBe('JPY')
})

it('does not throw when localStorage.setItem is unavailable', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  expect(() => saveShowIn('INR')).not.toThrow()
})

it('converts yen to paise and paise to yen via the planning rate', () => {
  expect(inOtherCurrency(169, 'JPY', '1.694915')).toBe(9971) // ¥169 ≈ ₹99.71 (9971 paise)
  expect(inOtherCurrency(10000, 'INR', '1.694915')).toBe(169) // ₹100.00 ≈ ¥169
})

// Final review finding 5: a null changePct (previous total was 0) is not the same as "first
// cycle" (changeJpy null) — there's still a real ¥ change to show, just no meaningful percent.
it('shows "first cycle" (null) only when changeJpy itself is null, not whenever changePct is null', () => {
  expect(netWorthChangeDisplay(null, null, String)).toBeNull()

  const zeroPrevTotal = netWorthChangeDisplay(50000, null, (abs) => `¥${abs}`)
  expect(zeroPrevTotal).not.toBeNull()
  expect(zeroPrevTotal).toEqual({ up: true, text: '↑ ¥50000' })

  const normal = netWorthChangeDisplay(-50000, 12.3, (abs) => `¥${abs}`)
  expect(normal).toEqual({ up: false, text: '↓ ¥50000 (12.3%)' })
})
