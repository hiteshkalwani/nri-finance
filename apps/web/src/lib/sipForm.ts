import { rupees } from './format'

/**
 * SIP-3's "Paid this cycle vs plan" word + bar fill (never colour alone, spec §7): short of plan,
 * ahead of it, or exactly on it. `null` plan (no entry for the current cycle yet) is treated as 0.
 */
export function vsPlanWord(paidPaise: number, plannedPaise: number): { text: string; cls: 'good' | 'bad' | 'muted'; pct: number } {
  const pct = plannedPaise > 0 ? Math.min(100, Math.round((paidPaise / plannedPaise) * 100)) : paidPaise > 0 ? 100 : 0
  const diff = paidPaise - plannedPaise
  if (diff === 0) return { text: 'On plan', cls: 'muted', pct }
  if (diff > 0) return { text: `${rupees(diff)} ahead`, cls: 'good', pct }
  return { text: `${rupees(-diff)} short`, cls: 'bad', pct }
}

/** SIP-2: the live allocation total (percent, not hundredths) — "Save" is gated on this being exactly 100. */
export function allocationTotalPct(allocations: { pct: string }[]): number {
  return allocations.reduce((s, a) => s + Math.round(Number(a.pct || '0') * 100), 0) / 100
}
