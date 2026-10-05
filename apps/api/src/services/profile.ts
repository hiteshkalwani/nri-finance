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
