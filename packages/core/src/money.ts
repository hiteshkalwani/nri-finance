const MICRO = 1_000_000n

export function parseRate(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate)
  if (!m) throw new Error(`Invalid rate "${rate}": expected up to 6 decimals`)
  const micro = BigInt(m[1]!) * MICRO + BigInt((m[2] ?? '').padEnd(6, '0'))
  if (micro === 0n) throw new Error('Rate must be greater than zero')
  return micro
}

export function formatRate(micro: bigint): string {
  const whole = micro / MICRO
  const frac = (micro % MICRO).toString().padStart(6, '0')
  return `${whole}.${frac}`
}

export function rateFromNumber(n: number): string {
  return formatRate(BigInt(Math.round(n * 1_000_000)))
}

/** Half-up division for non-negative BigInts. */
function divRound(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n)
}

export function jpyFromInrPaise(paise: number, rate: string): number {
  return Number(divRound(BigInt(paise) * parseRate(rate), 100n * MICRO))
}

export function inrPaiseFromJpy(jpy: number, rate: string): number {
  return Number(divRound(BigInt(jpy) * 100n * MICRO, parseRate(rate)))
}

export function effectiveRate(jpySent: number, inrPaise: number): string {
  return formatRate(divRound(BigInt(jpySent) * 100n * MICRO, BigInt(inrPaise)))
}

export function paiseFromDecimal(s: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) throw new Error(`Invalid amount "${s}"`)
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

export function decimalFromPaise(p: number): string {
  return `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`
}
