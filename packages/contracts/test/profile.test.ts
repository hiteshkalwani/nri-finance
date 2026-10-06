import { expect, it } from 'vitest'
import { ProfileInput } from '../src/profile'

const base = { salaryJpy: 500000, planningRateJpyPerInr: '1.694915', cycleStartDay: 25, timezone: 'Asia/Tokyo' }

it('accepts an optional emergency-fund goal, null to clear', () => {
  expect(ProfileInput.parse(base).emergencyFundGoalJpy).toBeUndefined()
  expect(ProfileInput.parse({ ...base, emergencyFundGoalJpy: 2400000 }).emergencyFundGoalJpy).toBe(2400000)
  expect(ProfileInput.parse({ ...base, emergencyFundGoalJpy: null }).emergencyFundGoalJpy).toBeNull()
  expect(ProfileInput.safeParse({ ...base, emergencyFundGoalJpy: -1 }).success).toBe(false)
  expect(ProfileInput.safeParse({ ...base, emergencyFundGoalJpy: 1.5 }).success).toBe(false)
})
