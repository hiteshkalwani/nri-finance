import { z } from 'zod'

export const AccountType = z.enum(['bank', 'cash', 'card', 'fd', 'investment'])
export type AccountType = z.infer<typeof AccountType>
export const Country = z.enum(['JP', 'IN'])
export type Country = z.infer<typeof Country>

export const Account = z.object({
  id: z.uuid(),
  name: z.string(),
  country: Country,
  currency: z.enum(['JPY', 'INR']),
  type: AccountType,
  isEmergencyFund: z.boolean(),
  archived: z.boolean(),
  hasBalances: z.boolean(),
})
export type Account = z.infer<typeof Account>
export const AccountList = z.object({ items: z.array(Account) })

const AccountName = z.string().trim().min(1, 'Name is required').max(60)

export const AccountCreate = z.strictObject({
  name: AccountName,
  country: Country,
  type: AccountType,
  isEmergencyFund: z.boolean().optional(),
})
export type AccountCreate = z.infer<typeof AccountCreate>

export const AccountPatch = z
  .strictObject({ name: AccountName, country: Country, type: AccountType, isEmergencyFund: z.boolean(), archived: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to change')
export type AccountPatch = z.infer<typeof AccountPatch>

export const currencyFor = (country: 'JP' | 'IN') => (country === 'JP' ? 'JPY' : 'INR') as 'JPY' | 'INR'
