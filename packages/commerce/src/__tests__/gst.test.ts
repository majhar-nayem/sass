import { describe, expect, it } from 'vitest'
import { gstIncludedCents, taxableDeliveryCents } from '../gst.js'

/**
 * The ATO's total invoice rule: total the taxable lines, one eleventh, round once to
 * the nearest cent with half a cent rounding up.
 */
const taxable = (c: number) => ({ lineCents: c, gstFree: false })
const free = (c: number) => ({ lineCents: c, gstFree: true })

describe('GST on a mixed order', () => {
  it('leaves GST-free lines out entirely', () => {
    // A ham (taxable) and diced beef (fresh meat, GST-free).
    expect(gstIncludedCents([taxable(6800), free(4500)], true)).toBe(618)
  })

  it('is zero when everything is GST-free', () => {
    expect(gstIncludedCents([free(2250), free(4500)], true)).toBe(0)
  })

  it('is zero for a business that is not registered for GST', () => {
    expect(gstIncludedCents([taxable(6800)], false)).toBe(0)
  })
})

describe('rounding', () => {
  // The case that separates the two rules. Three taxable lines of $1.05: per line,
  // 9.545¢ rounds to 10¢ each, so 30¢; in total, 315/11 = 28.64¢ rounds to 29¢.
  it('rounds the total once, not each line', () => {
    expect(gstIncludedCents([taxable(105), taxable(105), taxable(105)], true)).toBe(29)
  })

  // The drift per-line rounding would build: fifty lines each carrying a half cent.
  it('stays within half a cent of exact however many lines there are', () => {
    const lines = Array.from({ length: 50 }, () => taxable(105))
    const exact = (50 * 105) / 11
    expect(Math.abs(gstIncludedCents(lines, true) - exact)).toBeLessThanOrEqual(0.5)
  })

  it('rounds to the nearest cent in both directions', () => {
    expect(gstIncludedCents([taxable(6781)], true)).toBe(616) // 616.45… rounds down
    expect(gstIncludedCents([taxable(6782)], true)).toBe(617) // 616.54… rounds up
  })

  // The ATO's "half a cent rounds upwards" never actually triggers here: one eleventh
  // of a whole number of cents has a fractional part of k/11, and k/11 is never 1/2
  // because 11 is odd. Asserted so nobody spends an afternoon hunting a tie-break case.
  it('can never land exactly on half a cent', () => {
    for (let c = 0; c < 11 * 50; c++) expect((c / 11) % 1).not.toBe(0.5)
  })
})

/**
 * M-09. Delivery takes the GST character of the goods — GSTR 2001/8, paragraph 77:
 * delivering GST-free food to the door is "a supply of delivered GST-free goods" with no
 * GST on the delivery. A mix is apportioned by relative value (paragraph 98).
 */
describe('GST on a delivery fee', () => {
  it('is nil when every item delivered is GST-free — the ATO’s own example', () => {
    expect(gstIncludedCents([free(4500)], true, 1000)).toBe(0)
  })

  it('is one eleventh of the fee when every item is taxable', () => {
    // $68 ham + $11 delivery, all taxable: 7900 / 11 = 718.18 → 718
    expect(gstIncludedCents([taxable(6800)], true, 1100)).toBe(718)
  })

  it('is apportioned by value on a mixed order', () => {
    // $60 taxable + $40 GST-free, $10 delivery: 60% of the delivery is taxable.
    // Taxable value 6000 + 600 = 6600 → GST 600 exactly.
    expect(gstIncludedCents([taxable(6000), free(4000)], true, 1000)).toBe(600)
    expect(taxableDeliveryCents([taxable(6000), free(4000)], 1000)).toBe(600)
  })

  it('still rounds once, over goods and delivery together', () => {
    // 3 × $1.05 taxable + $1.05 delivery: 420 / 11 = 38.18 → 38, one rounding.
    expect(gstIncludedCents([taxable(105), taxable(105), taxable(105)], true, 105)).toBe(38)
  })

  it('is nil for a business that is not registered, delivery or not', () => {
    expect(gstIncludedCents([taxable(6800)], false, 1100)).toBe(0)
  })
})
