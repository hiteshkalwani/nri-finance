import { z } from 'zod'
import { NeedWant, PaymentMethod } from './categories'
import { CycleString, IsoDateString, PG_INT_MAX } from './common'

const Amount = z.number().int().positive().max(PG_INT_MAX)
const fields = {
  occurredOn: IsoDateString,
  categoryId: z.uuid(),
  accountId: z.uuid().nullable(),
  paymentMethod: PaymentMethod,
  needWant: NeedWant,
  description: z.string().trim().max(200),
  notes: z.string().max(2000),
  amountJpy: Amount, // entered in ¥
  amountInrPaise: Amount, // entered in ₹ (TXN-4); converted to ¥ at the planning rate when saved
}
const notBoth = (o: { amountJpy?: number; amountInrPaise?: number }) => !(o.amountJpy !== undefined && o.amountInrPaise !== undefined)
const both = { message: 'Give either amountJpy or amountInrPaise, not both', path: ['amountJpy'] }

export const TransactionCreate = z
  .strictObject({
    ...fields,
    accountId: fields.accountId.optional(),
    description: fields.description.optional(),
    notes: fields.notes.optional(),
    amountJpy: Amount.optional(),
    amountInrPaise: Amount.optional(),
  })
  .refine(notBoth, both)
  .refine((o) => o.amountJpy !== undefined || o.amountInrPaise !== undefined, { message: 'Amount is required', path: ['amountJpy'] })
export type TransactionCreate = z.infer<typeof TransactionCreate>

export const TransactionPatch = z
  .strictObject(fields)
  .partial()
  .refine(notBoth, both)
  .refine((o) => Object.keys(o).length > 0, 'Nothing to change')
export type TransactionPatch = z.infer<typeof TransactionPatch>

/**
 * Undo after delete: re-create a row exactly as it was. Unlike TransactionCreate, this takes the
 * already-derived amount fields verbatim (no ¥/₹ conversion at today's rate) and allows an archived
 * category, since the row may have been the last one keeping that category "in use".
 */
export const TransactionRestore = z
  .strictObject({
    occurredOn: IsoDateString,
    categoryId: z.uuid(),
    accountId: z.uuid().nullable(),
    description: z.string().trim().max(200),
    notes: z.string().max(2000),
    paymentMethod: PaymentMethod,
    needWant: NeedWant,
    amountJpy: Amount,
    enteredCurrency: z.enum(['JPY', 'INR']),
    amountInrPaise: Amount.nullable(),
    rateUsed: z.string().nullable(),
  })
  .refine(
    (o) => (o.enteredCurrency === 'INR' ? o.amountInrPaise !== null && o.rateUsed !== null : o.amountInrPaise === null && o.rateUsed === null),
    { message: 'enteredCurrency must be consistent with amountInrPaise and rateUsed', path: ['enteredCurrency'] },
  )
export type TransactionRestore = z.infer<typeof TransactionRestore>

export const Transaction = z.object({
  id: z.uuid(),
  occurredOn: z.string(),
  cycle: z.string(),
  categoryId: z.uuid(),
  accountId: z.uuid().nullable(),
  description: z.string(),
  amountJpy: z.number().int(),
  enteredCurrency: z.enum(['JPY', 'INR']),
  amountInrPaise: z.number().int().nullable(),
  rateUsed: z.string().nullable(),
  paymentMethod: PaymentMethod,
  needWant: NeedWant,
  notes: z.string(),
})
export type Transaction = z.infer<typeof Transaction>

export const SortField = z.enum(['occurredOn', 'amountJpy', 'category', 'paymentMethod', 'needWant', 'description'])
export type SortField = z.infer<typeof SortField>

/** Query-string form: every value arrives as a string; empty strings are dropped by the API before parsing. */
export const TransactionQuery = z.object({
  cycle: CycleString.optional(),
  categoryId: z.uuid().optional(),
  paymentMethod: PaymentMethod.optional(),
  needWant: NeedWant.optional(),
  q: z.string().trim().max(100).optional(),
  sort: SortField.default('occurredOn'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type TransactionQuery = z.infer<typeof TransactionQuery>

export const TransactionPage = z.object({
  items: z.array(Transaction),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalJpy: z.number().int(),
})
export type TransactionPage = z.infer<typeof TransactionPage>
