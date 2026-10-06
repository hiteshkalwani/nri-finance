import { z } from 'zod'
import { AccountType, Country } from './accounts'
import { CycleString } from './common'

/** ₹ paise upper bound: numeric(14,2) fits at most 12 integer digits, i.e. ₹999,999,999,999.99. */
export const PAISE_MAX = 99_999_999_999_999

export const BalanceRow = z.object({
  accountId: z.uuid(),
  name: z.string(),
  country: Country,
  currency: z.enum(['JPY', 'INR']),
  type: AccountType,
  isEmergencyFund: z.boolean(),
  amount: z.number().int().nullable(), // yen or paise; null when source = 'none'
  source: z.enum(['this', 'carried', 'none']),
  fromCycle: CycleString.nullable(),
})
export type BalanceRow = z.infer<typeof BalanceRow>

export const BalancesResponse = z.object({
  cycle: CycleString,
  start: z.string(),
  end: z.string(),
  rate: z.string(),
  rows: z.array(BalanceRow),
})
export type BalancesResponse = z.infer<typeof BalancesResponse>

export const BalancesPut = z
  .strictObject({
    cycle: CycleString,
    entries: z
      .array(z.strictObject({ accountId: z.uuid(), amount: z.number().int().nonnegative().max(PAISE_MAX) }))
      .min(1)
      .max(200),
  })
  .refine((o) => new Set(o.entries.map((e) => e.accountId)).size === o.entries.length, {
    message: 'Each account once',
    path: ['entries'],
  })
export type BalancesPut = z.infer<typeof BalancesPut>
