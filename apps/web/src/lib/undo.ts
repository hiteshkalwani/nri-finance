import { ref } from 'vue'
import type { TransactionCreate } from '@nri/contracts'

/** The last deleted expense, offered for Undo on the ledger for a few seconds. */
export const undo = { pending: ref<TransactionCreate | null>(null) }
