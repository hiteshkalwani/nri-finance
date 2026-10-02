import { describe, expect, it } from 'vitest'
import {
  decimalFromPaise, effectiveRate, formatRate, inrPaiseFromJpy, jpyFromInrPaise, paiseFromDecimal, parseRate, rateFromNumber,
} from '../src/index'

describe('rates', () => {
  it('parses and formats 6-decimal rates exactly', () => {
    expect(parseRate('1.694915')).toBe(1_694_915n)
    expect(parseRate('2')).toBe(2_000_000n)
    expect(formatRate(1_694_915n)).toBe('1.694915')
  })
  it('rejects malformed rates', () => {
    expect(() => parseRate('1.2345678')).toThrow()
    expect(() => parseRate('-1')).toThrow()
    expect(() => parseRate('0')).toThrow()
  })
  it('rounds a float rate from v1 to 6 decimals', () => expect(rateFromNumber(1.694915254237288)).toBe('1.694915'))
})

describe('conversion', () => {
  it('converts ₹ paise to whole yen, half up', () => {
    expect(jpyFromInrPaise(1_000_00, '1.694915')).toBe(1695) // ₹1000 → ¥1694.915
    expect(jpyFromInrPaise(1_00, '2.5')).toBe(3) // ₹1 → ¥2.5 → 3
  })
  it('converts yen to ₹ paise, half up', () => {
    expect(inrPaiseFromJpy(1695, '1.694915')).toBe(1_000_05) // ₹1000.05
    expect(inrPaiseFromJpy(500, '2')).toBe(250_00)
  })
  it('computes the effective rate of a transfer', () => {
    expect(effectiveRate(50_000, 29_500_00)).toBe('1.694915')
  })
})

describe('decimal strings', () => {
  it('converts numeric strings from Postgres to paise and back', () => {
    expect(paiseFromDecimal('8006.00')).toBe(800_600)
    expect(paiseFromDecimal('555.19')).toBe(55_519)
    expect(paiseFromDecimal('12')).toBe(1_200)
    expect(paiseFromDecimal('0.5')).toBe(50)
    expect(decimalFromPaise(800_600)).toBe('8006.00')
    expect(decimalFromPaise(5)).toBe('0.05')
  })
})
