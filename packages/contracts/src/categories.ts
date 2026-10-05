import { z } from 'zod'

export const PaymentMethod = z.enum(['bank', 'cash', 'credit_card', 'ic_card'])
export type PaymentMethod = z.infer<typeof PaymentMethod>
export const NeedWant = z.enum(['need', 'want'])
export type NeedWant = z.infer<typeof NeedWant>

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a colour like #4caf50')
const Name = z.string().trim().min(1, 'Name is required').max(40)

export const CategoryCreate = z.strictObject({ name: Name, color: HexColor })
export type CategoryCreate = z.infer<typeof CategoryCreate>

export const CategoryPatch = z
  .strictObject({ name: Name, color: HexColor, archived: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to change')
export type CategoryPatch = z.infer<typeof CategoryPatch>

export const CategoryOrder = z.strictObject({ ids: z.array(z.uuid()).min(1).max(500) })

export const Category = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(), // imported v1 colours are passed through as stored
  sortOrder: z.number().int(),
  archived: z.boolean(),
  inUse: z.boolean(),
  lastPaymentMethod: PaymentMethod.nullable(),
  lastNeedWant: NeedWant.nullable(),
})
export type Category = z.infer<typeof Category>
export const CategoryList = z.object({ items: z.array(Category) })
