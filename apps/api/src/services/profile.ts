import { eq } from 'drizzle-orm'
import { formatRate, parseRate } from '@nri/core'
import { profiles, type Tx } from '@nri/db'
import { ApiError } from '../errors'

export async function getProfileRow(tx: Tx, userId: string) {
  const [row] = await tx.select().from(profiles).where(eq(profiles.userId, userId))
  return row ?? null
}

export async function requireProfile(tx: Tx, userId: string) {
  const row = await getProfileRow(tx, userId)
  if (!row) throw new ApiError(409, 'CONFLICT', 'Set up your profile first')
  return row
}

// numeric(12,6) comes back as "1.694915"; API rates are always padded to 6 decimals (TRD).
export const rateOut = (s: string): string => formatRate(parseRate(s))
