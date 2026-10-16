import { computed, ref } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Targets, type TargetKey, type TargetRow, type TargetsPut } from '@nri/contracts'
import { decimalFromPaise } from '@nri/core'
import { apiFetch, ApiRequestError } from './api'
import { parseAmount } from './balancesForm'

export const TARGET_KEYS: TargetKey[] = ['savings', 'emergencyFund', 'remittance', 'prepayment']
/** Mockup's own wording (nri-ui-mockup.html's `TGT` array) — distinct from core's internal, unexported labels. */
export const TARGET_LABELS: Record<TargetKey, string> = {
  savings: 'Savings (kept)',
  emergencyFund: 'Emergency fund contribution',
  remittance: 'Remittance',
  prepayment: 'Loan prepayment',
}
export const TARGET_CURRENCY: Record<TargetKey, 'JPY' | 'INR'> = {
  savings: 'JPY', emergencyFund: 'JPY', remittance: 'JPY', prepayment: 'INR',
}

export type TargetFields = Record<TargetKey, string>
const KEY_TO_GET: Record<TargetKey, 'savingsJpy' | 'emergencyFundJpy' | 'remittanceJpy' | 'prepaymentPaise'> = {
  savings: 'savingsJpy', emergencyFund: 'emergencyFundJpy', remittance: 'remittanceJpy', prepayment: 'prepaymentPaise',
}

/** GET /api/targets/:cycle's raw amounts (¥ for 3, paise for prepayment) as the 4 editable field texts. */
export function targetFieldsFrom(t: Targets): TargetFields {
  const out = {} as TargetFields
  for (const k of TARGET_KEYS) {
    const v = t[KEY_TO_GET[k]]
    out[k] = v === null ? '' : k === 'prepayment' ? decimalFromPaise(v) : String(v)
  }
  return out
}

export function hasInvalidTargetField(fields: TargetFields): boolean {
  return TARGET_KEYS.some((k) => parseAmount(fields[k], TARGET_CURRENCY[k]) === 'invalid')
}

export function isDirtyTargets(fields: TargetFields, initial: TargetFields): boolean {
  return TARGET_KEYS.some((k) => parseAmount(fields[k], TARGET_CURRENCY[k]) !== parseAmount(initial[k], TARGET_CURRENCY[k]))
}

/** Full-replace PUT body (TGT-1): blank field → null; `null` overall when any field is invalid. */
export function targetsPutFrom(fields: TargetFields): TargetsPut | null {
  if (hasInvalidTargetField(fields)) return null
  const parsed = Object.fromEntries(TARGET_KEYS.map((k) => [k, parseAmount(fields[k], TARGET_CURRENCY[k]) as number | null]))
  return {
    savingsJpy: parsed.savings ?? null,
    emergencyFundJpy: parsed.emergencyFund ?? null,
    remittanceJpy: parsed.remittance ?? null,
    prepaymentPaise: parsed.prepayment ?? null,
  }
}

/** TGT-2's met/short word for one target row, e.g. "✓ Met · +¥5,000" or "✗ ¥10,000 short". */
export function targetStateText(row: TargetRow, fmt: (n: number) => string): string {
  if (row.met) return row.diff > 0 ? `✓ Met · +${fmt(row.diff)}` : '✓ Met'
  return `✗ ${fmt(-row.diff)} short`
}

/**
 * "Copy last/this cycle" (TGT-1): POST .../copy-previous, confirming an overwrite on a 409 — same
 * mechanic for Budgets' "Copy last cycle" (copies from the cycle before `cycle()`) and Review step
 * 3's "Copy this cycle" (`cycle()` there is the *next* cycle, so "previous" is the review's own
 * closed cycle) — only the button's own cycle differs between the two callers.
 */
export function useCopyPreviousTargets(cycle: () => string, onDone: (t: Targets) => void) {
  const qc = useQueryClient()
  const confirmOpen = ref(false)
  const error = ref('')
  const mutation = useMutation({
    mutationFn: (overwrite: boolean) =>
      apiFetch(`/api/targets/${cycle()}/copy-previous${overwrite ? '?overwrite=true' : ''}`, { method: 'POST' }, Targets),
    onSuccess: async (t) => {
      confirmOpen.value = false
      error.value = ''
      await qc.invalidateQueries({ queryKey: ['targets'] })
      onDone(t)
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409) { confirmOpen.value = true; return }
      error.value = e instanceof ApiRequestError ? e.message : 'Could not copy targets'
    },
  })
  return {
    confirmOpen,
    error,
    pending: computed(() => mutation.isPending.value),
    copy: () => mutation.mutate(false),
    overwrite: () => mutation.mutate(true),
    cancel: () => { confirmOpen.value = false },
  }
}
