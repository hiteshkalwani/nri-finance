import { eq } from 'drizzle-orm'
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

// numeric(12,6) comes back as "1.694915"; trim trailing zeros but keep at least one decimal digit.
export const rateOut = (s: string): string => s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '.0')
