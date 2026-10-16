import { and, eq, sql } from 'drizzle-orm'
import type { Targets, TargetsPut } from '@nri/contracts'
import { decimalFromPaise, type Cycle, paiseFromDecimal, previousCycle } from '@nri/core'
import { cycleTargets, type Tx } from '@nri/db'
import { ApiError } from '../errors'

type Row = typeof cycleTargets.$inferSelect

function toTargets(cycle: Cycle, row: Row | undefined): Targets {
  if (!row) return { cycle, savingsJpy: null, emergencyFundJpy: null, remittanceJpy: null, prepaymentPaise: null }
  return {
    cycle,
    savingsJpy: row.savingsTargetJpy,
    emergencyFundJpy: row.emergencyFundTargetJpy,
    remittanceJpy: row.remittanceTargetJpy,
    prepaymentPaise: row.prepaymentTargetInr === null ? null : paiseFromDecimal(row.prepaymentTargetInr),
  }
}

async function getRow(tx: Tx, userId: string, cycle: Cycle): Promise<Row | undefined> {
  const [row] = await tx.select().from(cycleTargets).where(and(eq(cycleTargets.userId, userId), eq(cycleTargets.cycle, cycle)))
  return row
}

export async function getTargets(tx: Tx, userId: string, cycle: Cycle): Promise<Targets> {
  return toTargets(cycle, await getRow(tx, userId, cycle))
}

/** Whether a targets row was ever saved for this cycle — distinct from "saved but all null". */
export async function targetsExist(tx: Tx, userId: string, cycle: Cycle): Promise<boolean> {
  return (await getRow(tx, userId, cycle)) !== undefined
}

/** TGT-1: one row per user per cycle (upsert); full replace, like the SIP plan. */
export async function putTargets(tx: Tx, userId: string, cycle: Cycle, input: TargetsPut): Promise<Targets> {
  const values = {
    savingsTargetJpy: input.savingsJpy,
    emergencyFundTargetJpy: input.emergencyFundJpy,
    remittanceTargetJpy: input.remittanceJpy,
    prepaymentTargetInr: input.prepaymentPaise === null ? null : decimalFromPaise(input.prepaymentPaise),
  }
  const [row] = await tx.insert(cycleTargets).values({ userId, cycle, ...values })
    .onConflictDoUpdate({ target: [cycleTargets.userId, cycleTargets.cycle], set: { ...values, updatedAt: sql`now()` } })
    .returning()
  return toTargets(cycle, row)
}

/** TGT-1 "copy last cycle": 409 if `cycle` already has targets unless `overwrite`; 400 if the previous cycle has none. */
export async function copyPreviousTargets(tx: Tx, userId: string, cycle: Cycle, overwrite: boolean): Promise<Targets> {
  const existing = await getRow(tx, userId, cycle)
  if (existing && !overwrite) throw new ApiError(409, 'CONFLICT', `${cycle} already has targets`)
  const prevCycle = previousCycle(cycle)
  const prev = await getRow(tx, userId, prevCycle)
  if (!prev) throw new ApiError(400, 'VALIDATION_FAILED', `${prevCycle} has no targets to copy`)
  return putTargets(tx, userId, cycle, {
    savingsJpy: prev.savingsTargetJpy,
    emergencyFundJpy: prev.emergencyFundTargetJpy,
    remittanceJpy: prev.remittanceTargetJpy,
    prepaymentPaise: prev.prepaymentTargetInr === null ? null : paiseFromDecimal(prev.prepaymentTargetInr),
  })
}
