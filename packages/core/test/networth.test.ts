import { describe, expect, it } from 'vitest'
import { balanceAt, changeSince, emergencyFundAt, monthsCovered, netWorthAt, type NwAccount, type Snapshot } from '../src/networth'

const RATE = '1.7' // ¥1.7 per ₹1
const jp: NwAccount = { id: 'jp', country: 'JP', type: 'bank', isEmergencyFund: false, archivedCycle: null }
const ef: NwAccount = { id: 'ef', country: 'JP', type: 'bank', isEmergencyFund: true, archivedCycle: null }
const inr: NwAccount = { id: 'in', country: 'IN', type: 'bank', isEmergencyFund: true, archivedCycle: null }
const card: NwAccount = { id: 'card', country: 'JP', type: 'card', isEmergencyFund: true, archivedCycle: null }
const s = (accountId: string, cycle: string, amount: number): Snapshot => ({ accountId, cycle, amount })

describe('balanceAt', () => {
  const snaps = [s('jp', '2026-08', 100), s('jp', '2026-10', 300)]
  it('uses this cycle, else carries the latest earlier one, else null', () => {
    expect(balanceAt(snaps, jp, '2026-10')).toEqual({ amount: 300, fromCycle: '2026-10', carried: false })
    expect(balanceAt(snaps, jp, '2026-09')).toEqual({ amount: 100, fromCycle: '2026-08', carried: true })
    expect(balanceAt(snaps, jp, '2026-07')).toBeNull()
  })
  it('backfilling an older cycle fills only the gap; newer cycles keep their own values', () => {
    const backfilled = [...snaps, s('jp', '2026-09', 200)]
    expect(balanceAt(backfilled, jp, '2026-09')!.amount).toBe(200)
    expect(balanceAt(backfilled, jp, '2026-10')!.amount).toBe(300)
    expect(balanceAt(backfilled, jp, '2026-11')).toEqual({ amount: 300, fromCycle: '2026-10', carried: true })
  })
  it('stops carrying an archived account after its archive cycle', () => {
    const archived = { ...ef, archivedCycle: '2026-09' }
    const snapsEf = [s('ef', '2026-08', 500)]
    expect(balanceAt(snapsEf, archived, '2026-09')!.amount).toBe(500)
    expect(balanceAt(snapsEf, archived, '2026-10')).toBeNull()
  })
})

describe('netWorthAt', () => {
  it('adds assets, subtracts cards, converts ₹ at the rate', () => {
    const snaps = [s('jp', '2026-10', 100000), s('card', '2026-10', 42000), s('in', '2026-10', 1000000)] // ₹10,000.00
    expect(netWorthAt([jp, card, inr], snaps, '2026-10', RATE)).toEqual({
      japanJpy: 58000, indiaPaise: 1000000, combinedJpy: 58000 + 17000,
      assets: { japanJpy: 100000, indiaPaise: 1000000 }, liabilities: { japanJpy: 42000, indiaPaise: 0 },
    })
  })
  it('is all zeros with no snapshots', () => {
    expect(netWorthAt([jp], [], '2026-10', RATE).combinedJpy).toBe(0)
  })
})

describe('emergencyFundAt', () => {
  it('sums flagged non-card accounts, ₹ converted, carried forward', () => {
    const snaps = [s('ef', '2026-09', 300000), s('in', '2026-10', 1000000), s('card', '2026-10', 5000), s('jp', '2026-10', 1)]
    expect(emergencyFundAt([jp, ef, inr, card], snaps, '2026-10', RATE)).toBe(300000 + 17000)
  })
  it('drops an emergency-fund account after it is archived, keeps it for earlier cycles', () => {
    const archived = { ...ef, archivedCycle: '2026-09' }
    const snaps = [s('ef', '2026-08', 300000)]
    expect(emergencyFundAt([archived], snaps, '2026-09', RATE)).toBe(300000)
    expect(emergencyFundAt([archived], snaps, '2026-10', RATE)).toBe(0)
  })
})

describe('changeSince / monthsCovered', () => {
  it('reports amount and one-decimal percent; null percent without a positive base', () => {
    expect(changeSince(1429069, 1216769)).toEqual({ changeJpy: 212300, changePct: 17.4 })
    expect(changeSince(500, null)).toEqual({ changeJpy: null, changePct: null })
    expect(changeSince(500, 0)).toEqual({ changeJpy: 500, changePct: null })
    expect(changeSince(-100, -200)).toEqual({ changeJpy: 100, changePct: 50 })
  })
  it('divides by the average of the prior cycles given, one decimal; null without data', () => {
    expect(monthsCovered(2000000, [300000, 327000, 354000])).toEqual({ monthsCovered: 6.1, avgSpendJpy: 327000 })
    expect(monthsCovered(100000, [50000])).toEqual({ monthsCovered: 2, avgSpendJpy: 50000 })
    expect(monthsCovered(100000, [])).toEqual({ monthsCovered: null, avgSpendJpy: null })
    expect(monthsCovered(100000, [0, 0])).toEqual({ monthsCovered: null, avgSpendJpy: 0 })
  })
})
