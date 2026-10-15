import { ref } from 'vue'
import type { RemittanceInput, TransactionRestore } from '@nri/contracts'

/**
 * The last deleted expense/transfer, offered for Undo on the ledger/Remit list for a few seconds.
 * A transfer's undo re-POSTs `pendingRemittance` verbatim (design decision: no restore route).
 */
export const undo = { pending: ref<TransactionRestore | null>(null), pendingRemittance: ref<RemittanceInput | null>(null) }
