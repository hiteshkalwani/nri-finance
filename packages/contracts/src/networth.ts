import { z } from 'zod'
import { CycleString } from './common'

export const NetWorthResponse = z.object({
  rate: z.string(),
  cycle: CycleString,
  current: z.object({
    japanJpy: z.number().int(),
    indiaPaise: z.number().int(),
    combinedJpy: z.number().int(),
    changeJpy: z.number().int().nullable(),
    changePct: z.number().nullable(),
  }),
  assets: z.object({ japanJpy: z.number().int(), indiaPaise: z.number().int() }),
  liabilities: z.object({ japanJpy: z.number().int(), indiaPaise: z.number().int() }),
  series: z.array(z.object({ cycle: CycleString, combinedJpy: z.number().int() })),
  accounts: z.array(
    z.object({
      accountId: z.uuid(),
      amount: z.number().int().nullable(),
      source: z.enum(['this', 'carried', 'none']),
      fromCycle: CycleString.nullable(),
      changeAmount: z.number().int().nullable(), // own currency; vs previous cycle's balanceAt
    }),
  ),
  emergencyFund: z.object({
    balanceJpy: z.number().int(),
    goalJpy: z.number().int().nullable(),
    monthsCovered: z.number().nullable(),
    avgSpendJpy: z.number().int().nullable(),
  }),
})
export type NetWorthResponse = z.infer<typeof NetWorthResponse>

export const NetWorthSpan = z.enum(['6', '12', 'all'])
export type NetWorthSpan = z.infer<typeof NetWorthSpan>
