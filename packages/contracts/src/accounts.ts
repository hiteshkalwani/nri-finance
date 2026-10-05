import { z } from 'zod'

export const Account = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.enum(['JP', 'IN']),
  currency: z.enum(['JPY', 'INR']),
  type: z.enum(['bank', 'cash', 'card', 'fd', 'investment']),
  isEmergencyFund: z.boolean(),
})
export type Account = z.infer<typeof Account>
export const AccountList = z.object({ items: z.array(Account) })
