import { z } from 'zod'
import { RateString } from './common'

export const ProfileInput = z.object({
  salaryJpy: z.number().int().nonnegative(),
  planningRateJpyPerInr: RateString,
  cycleStartDay: z.number().int().min(1).max(28),
  timezone: z.string().min(1).max(64),
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
