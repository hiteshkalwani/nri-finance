import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BalancesPut, PAISE_MAX } from '../src'

const id1 = randomUUID()
const id2 = randomUUID()

describe('BalancesPut', () => {
  it('rejects duplicate accountIds', () => {
    const r = BalancesPut.safeParse({
      cycle: '2026-10',
      entries: [{ accountId: id1, amount: 1 }, { accountId: id1, amount: 2 }],
    })
    expect(r.success).toBe(false)
  })

  it('rejects negative amounts', () => {
    expect(BalancesPut.safeParse({ cycle: '2026-10', entries: [{ accountId: id1, amount: -1 }] }).success).toBe(false)
  })

  it('rejects non-integer amounts', () => {
    expect(BalancesPut.safeParse({ cycle: '2026-10', entries: [{ accountId: id1, amount: 1.5 }] }).success).toBe(false)
  })

  it('rejects amounts above PAISE_MAX', () => {
    expect(
      BalancesPut.safeParse({ cycle: '2026-10', entries: [{ accountId: id1, amount: PAISE_MAX + 1 }] }).success,
    ).toBe(false)
  })

  it('accepts PAISE_MAX exactly', () => {
    expect(BalancesPut.safeParse({ cycle: '2026-10', entries: [{ accountId: id1, amount: PAISE_MAX }] }).success).toBe(
      true,
    )
  })

  it('rejects empty entries', () => {
    expect(BalancesPut.safeParse({ cycle: '2026-10', entries: [] }).success).toBe(false)
  })

  it('accepts multiple distinct accounts', () => {
    expect(
      BalancesPut.safeParse({
        cycle: '2026-10',
        entries: [{ accountId: id1, amount: 1 }, { accountId: id2, amount: 2 }],
      }).success,
    ).toBe(true)
  })
})
