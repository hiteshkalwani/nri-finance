import { describe, expect, it } from 'vitest'
import { cycleRange, lastCycles, nextCycle, previousCycle } from '../src'

describe('cycle navigation', () => {
  it('steps back and forward across a year boundary', () => {
    expect(previousCycle('2026-01')).toBe('2025-12')
    expect(previousCycle('2026-10')).toBe('2026-09')
    expect(nextCycle('2025-12')).toBe('2026-01')
  })
  it('lists an inclusive range in order, and nothing when from is after to', () => {
    expect(cycleRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(cycleRange('2026-02', '2026-02')).toEqual(['2026-02'])
    expect(cycleRange('2026-03', '2026-02')).toEqual([])
  })
  it('gives the last n cycles ending at a cycle, oldest first', () => {
    const twelve = lastCycles('2026-10', 12)
    expect(twelve).toHaveLength(12)
    expect(twelve[0]).toBe('2025-11')
    expect(twelve[11]).toBe('2026-10')
  })
  it('returns empty for n <= 0, and the cycle itself for n = 1', () => {
    expect(lastCycles('2026-10', 0)).toEqual([])
    expect(lastCycles('2026-10', -1)).toEqual([])
    expect(lastCycles('2026-10', 1)).toEqual(['2026-10'])
  })
})
