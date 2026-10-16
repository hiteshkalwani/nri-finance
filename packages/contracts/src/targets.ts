import { z } from 'zod'
import { PAISE_MAX } from './balances'
import { CycleString, PG_INT_MAX } from './common'

export const TargetKey = z.enum(['savings', 'emergencyFund', 'remittance', 'prepayment'])
export type TargetKey = z.infer<typeof TargetKey>

/** TGT-2: one row per target that was set; diff = actual - target, met when actual >= target. */
export const TargetRow = z.object({
  key: TargetKey,
  targetValue: z.number().int(),
  actualValue: z.number().int(),
  diff: z.number().int(),
  met: z.boolean(),
})
export type TargetRow = z.infer<typeof TargetRow>

export const Targets = z.object({
  cycle: CycleString,
  savingsJpy: z.number().int().nullable(),
  emergencyFundJpy: z.number().int().nullable(),
  remittanceJpy: z.number().int().nullable(),
  prepaymentPaise: z.number().int().nullable(),
})
export type Targets = z.infer<typeof Targets>

/** TGT-1: full replace, like the SIP plan's PUT; null leaves that target unset. */
export const TargetsPut = z.strictObject({
  savingsJpy: z.number().int().min(0).max(PG_INT_MAX).nullable(),
  emergencyFundJpy: z.number().int().min(0).max(PG_INT_MAX).nullable(),
  remittanceJpy: z.number().int().min(0).max(PG_INT_MAX).nullable(),
  prepaymentPaise: z.number().int().min(0).max(PAISE_MAX).nullable(),
})
export type TargetsPut = z.infer<typeof TargetsPut>
