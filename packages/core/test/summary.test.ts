import { describe, expect, it } from 'vitest'
import { spendByCategory, spendByCycle, summarizeCycle } from '../src'

const t = (occurredOn: string, amountJpy: number, categoryId = 'food', needWant: 'need' | 'want' = 'need') => ({ occurredOn, amountJpy, categoryId, needWant })
const r = (sentOn: string, jpySent: number, feeJpy = 0, inrPaise = 0, purpose = 'family') => ({ sentOn, jpySent, feeJpy, inrPaise, purpose })

describe('summarizeCycle', () => {
  const transactions = [t('2026-09-24', 1000), t('2026-09-25', 2000), t('2026-10-24', 500, 'rent'), t('2026-10-25', 700)]
  const remittances = [r('2026-09-24', 5000, 100, 294_500, 'family'), r('2026-10-01', 100000, 500, 5_900_000, 'sip')]

  it('counts the 25th–24th window only, fees apart from money sent', () => {
    expect(summarizeCycle({ transactions, remittances, incomeJpy: 300000, cycle: '2026-10', startDay: 25 })).toEqual({
      incomeJpy: 300000, spentJpy: 2500, sentJpy: 100000, feesJpy: 500, receivedPaise: 5_900_000, keptJpy: 197500, savingsRatePct: 65.8,
      expenseCount: 2, largestJpy: 2000, needJpy: 2500, wantJpy: 0,
      sentByPurpose: [{ purpose: 'sip', jpySent: 100000, inrPaise: 5_900_000, count: 1 }],
    })
  })

  it('reports count, largest, and the needs/wants split for the cycle', () => {
    const rows = [t('2026-09-25', 2000, 'food', 'need'), t('2026-10-01', 500, 'fun', 'want'), t('2026-10-24', 85000, 'rent', 'need'), t('2026-10-25', 9999)]
    expect(summarizeCycle({ transactions: rows, remittances: [], incomeJpy: 100000, cycle: '2026-10', startDay: 25 })).toMatchObject({
      expenseCount: 3, largestJpy: 85000, needJpy: 87000, wantJpy: 500,
    })
    expect(summarizeCycle({ transactions: [], remittances: [], incomeJpy: 1, cycle: '2026-10', startDay: 25 })).toMatchObject({
      expenseCount: 0, largestJpy: 0, needJpy: 0, wantJpy: 0, receivedPaise: 0, sentByPurpose: [],
    })
  })
  it('rolls December 25 into January of the next year', () => {
    const s = summarizeCycle({ transactions: [t('2025-12-25', 900)], remittances: [], incomeJpy: 1000, cycle: '2026-01', startDay: 25 })
    expect(s.spentJpy).toBe(900)
  })
  it('allows a negative kept amount', () => {
    const s = summarizeCycle({ transactions: [t('2026-10-01', 1500)], remittances: [], incomeJpy: 1000, cycle: '2026-10', startDay: 25 })
    expect(s.keptJpy).toBe(-500)
    expect(s.savingsRatePct).toBe(-50)
  })
  it('has no savings rate without income', () => {
    expect(summarizeCycle({ transactions: [], remittances: [], incomeJpy: 0, cycle: '2026-10', startDay: 25 }).savingsRatePct).toBeNull()
  })
})

describe('summarizeCycle sentByPurpose', () => {
  const cycle = '2026-10'
  const startDay = 25
  // sip aggregates two rows (¥60,000, ₹35,150.00, count 2) and sorts first; family and other tie at
  // ¥50,000 and break alphabetically.
  const remits = [
    r('2026-10-01', 50000, 100, 2_950_000, 'family'),
    r('2026-10-05', 30000, 0, 1_750_000, 'sip'),
    r('2026-10-10', 30000, 0, 1_765_000, 'sip'),
    r('2026-10-15', 50000, 0, 2_900_000, 'other'),
  ]

  it('aggregates ¥ sent / ₹ received / count by purpose, largest ¥ sent first, ties by purpose name', () => {
    const s = summarizeCycle({ transactions: [], remittances: remits, incomeJpy: 500000, cycle, startDay })
    expect(s.receivedPaise).toBe(2_950_000 + 3_515_000 + 2_900_000)
    expect(s.sentByPurpose).toEqual([
      { purpose: 'sip', jpySent: 60000, inrPaise: 3_515_000, count: 2 },
      { purpose: 'family', jpySent: 50000, inrPaise: 2_950_000, count: 1 },
      { purpose: 'other', jpySent: 50000, inrPaise: 2_900_000, count: 1 },
    ])
  })
})

describe('spendByCategory / spendByCycle', () => {
  const rows = [t('2026-09-25', 300, 'b'), t('2026-10-01', 500, 'a'), t('2026-10-02', 200, 'b'), t('2026-08-30', 999, 'a')]
  it('totals categories in the cycle, largest first', () => {
    expect(spendByCategory(rows, '2026-10', 25)).toEqual([{ categoryId: 'b', spentJpy: 500 }, { categoryId: 'a', spentJpy: 500 }].sort(
      (x, y) => y.spentJpy - x.spentJpy || x.categoryId.localeCompare(y.categoryId)))
  })
  it('fills every requested cycle, zeros included, in the given order', () => {
    expect(spendByCycle(rows, ['2026-08', '2026-09', '2026-10'], 25)).toEqual([
      { cycle: '2026-08', spentJpy: 0 }, { cycle: '2026-09', spentJpy: 999 }, { cycle: '2026-10', spentJpy: 1000 },
    ])
  })
})
