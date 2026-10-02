import { z } from 'zod'
import { PG_INT_MAX, RateString, TimeZoneString } from './common'

export const ProfileInput = z.object({
  salaryJpy: z.number().int().nonnegative().max(PG_INT_MAX),
  planningRateJpyPerInr: RateString,
  cycleStartDay: z.number().int().min(1).max(28),
  timezone: TimeZoneString,
})
export type ProfileInput = z.infer<typeof ProfileInput>
export const Profile = ProfileInput
export type Profile = z.infer<typeof Profile>

export const MeResponse = z.object({
  userId: z.string().uuid(),
  email: z.string().nullable(),
  profile: Profile.nullable(),
})
export type MeResponse = z.infer<typeof MeResponse>
