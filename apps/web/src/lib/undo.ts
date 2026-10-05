import { ref } from 'vue'
import type { TransactionRestore } from '@nri/contracts'

/** The last deleted expense, offered for Undo on the ledger for a few seconds. */
export const undo = { pending: ref<TransactionRestore | null>(null) }
