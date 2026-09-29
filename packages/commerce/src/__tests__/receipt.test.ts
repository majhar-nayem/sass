import { describe, expect, it } from 'vitest'
import { buildReceipt, renderReceiptText, type ReceiptInput } from '../receipt.js'

/**
 * M-08, against the ATO's list of what a tax invoice must show
 * (ato.gov.au › GST › Tax invoices). One describe per requirement.
 */
const ABN = '51824753556' // the ABR's own worked example; passes the check
const base = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  seller: { name: "Dave's Meats", abn: ABN, gstRegistered: true },
  orderNumber: 12,
  issuedAt: new Date('2026-12-20T13:30:00Z'), // 21 December in Adelaide
  lines: [
    { title: 'Christmas Ham (cooked)', qty: 1, unitCents: 6800, lineCents: 6800, gstFree: false },
    { title: 'Diced Beef (fresh)', qty: 2, unitCents: 2250, lineCents: 4500, gstFree: true },
  ],
  totalCents: 11300,
  buyer: { name: 'Jane Citizen', email: 'jane@example.test' },
  ...over,
})

describe('the acceptance criterion: which items are taxable', () => {
  it('shows the fresh meat as GST-free and the cooked ham as including GST', () => {
    const r = buildReceipt(base())
    expect(r.lines.find((l) => l.description.includes('Beef'))!.taxable).toBe(false)
    expect(r.lines.find((l) => l.description.includes('Ham'))!.taxable).toBe(true)
    const text = renderReceiptText(r)
    expect(text).toMatch(/Diced Beef \(fresh\).*GST-free/)
    expect(text).toMatch(/Christmas Ham \(cooked\).*incl\. GST/)
  })

  // GST on a mixed sale is not a fixed fraction of the total, so the ATO's
  // "Total price includes GST" shortcut would be wrong here.
  it('on a mixed sale, states the GST on the taxable items rather than on the total', () => {
    const r = buildReceipt(base())
    expect(r.mixed).toBe(true)
    expect(r.gstCents).toBe(618) // one eleventh of the ham only
    expect(r.gstStatement).toBe('GST included on taxable items: $6.18')
  })

  it('uses the ATO wording "Total price includes GST" when every item is taxable', () => {
    const r = buildReceipt(base({ lines: [base().lines[0]!], totalCents: 6800 }))
    expect(r.gstStatement).toBe('Total price includes GST of $6.18')
  })
})

describe('the seven details a tax invoice must show', () => {
  const r = buildReceipt(base())
  it('1. that it is intended to be a tax invoice', () => expect(r.title).toBe('Tax invoice'))
  it('2. the seller', () => expect(r.seller).toBe("Dave's Meats"))
  it('3. the seller’s ABN, formatted the way the ABR prints it', () => expect(r.abn).toBe('51 824 753 556'))
  it('4. the date, in the business’s own timezone', () => expect(r.issuedOn).toBe('21 December 2026'))
  it('5. the items, with quantity and price', () =>
    expect(r.lines[1]).toMatchObject({ description: 'Diced Beef (fresh)', qty: 2, lineCents: 4500 }))
  it('6. the GST payable', () => expect(r.gstCents).toBe(618))
  it('7. the extent to which each sale is taxable', () => expect(r.lines.map((l) => l.taxable)).toEqual([true, false]))
})

describe('when it must NOT call itself a tax invoice', () => {
  it('without an ABN, it is a receipt, and the owner is told why', () => {
    const r = buildReceipt(base({ seller: { name: "Dave's Meats", abn: null, gstRegistered: true } }))
    expect(r.title).toBe('Receipt')
    expect(r.problems.join()).toMatch(/no ABN/)
  })

  it('with an ABN that fails the check, it is a receipt, and the bad number is not printed', () => {
    const r = buildReceipt(base({ seller: { name: "Dave's Meats", abn: '51824753557', gstRegistered: true } }))
    expect(r.title).toBe('Receipt')
    expect(r.abn).toBeNull()
    expect(renderReceiptText(r)).not.toContain('51 824 753 557')
  })

  // A business under the GST threshold does not charge GST. Showing any would be false.
  it('for a business not registered for GST: a receipt with no GST on it anywhere', () => {
    const r = buildReceipt(base({ seller: { name: "Dave's Meats", abn: ABN, gstRegistered: false } }))
    expect(r.title).toBe('Receipt')
    expect(r.gstCents).toBe(0)
    expect(r.gstStatement).toBeNull()
    expect(r.lines.every((l) => l.taxable === null)).toBe(true)
    expect(renderReceiptText(r)).not.toMatch(/GST/)
    // Correct behaviour, not a failing to report to the owner.
    expect(r.problems).toEqual([])
  })
})

describe('sales of $1,000 or more', () => {
  const big = (buyer: ReceiptInput['buyer']) =>
    buildReceipt(base({
      lines: [{ title: 'Whole spit-roast lamb', qty: 1, unitCents: 120000, lineCents: 120000, gstFree: false }],
      totalCents: 120000,
      buyer,
    }))

  it('show the buyer', () => {
    const r = big({ name: 'Jane Citizen' })
    expect(r.title).toBe('Tax invoice')
    expect(renderReceiptText(r)).toContain('Billed to: Jane Citizen')
  })

  it('without a buyer name, cannot be a tax invoice', () => {
    const r = big({ name: null, email: 'jane@example.test' })
    expect(r.title).toBe('Receipt')
    expect(r.problems.join()).toMatch(/\$1,000 or more/)
  })

  it('below $1,000, a missing buyer name is fine', () => {
    expect(buildReceipt(base({ buyer: { name: null } })).title).toBe('Tax invoice')
  })
})

describe('the description of what was sold', () => {
  it('wraps a long item name instead of cutting it off', () => {
    const name = 'Pork & fennel sausages (marinated, family pack)'
    const text = renderReceiptText(
      buildReceipt(base({ lines: [{ title: name, qty: 1, unitCents: 1650, lineCents: 1650, gstFree: false }], totalCents: 1650 })),
    )
    expect(text).toContain(`1 × ${name}`)
    expect(text).toMatch(/\$16\.50 {2}incl\. GST/)
  })
})

describe('the seller’s identity', () => {
  it('shows the legal entity beside the trading name when they differ', () => {
    const r = buildReceipt(base({ seller: { name: "Dave's Meats", legalName: 'Smith Family Holdings Pty Ltd', abn: ABN, gstRegistered: true } }))
    expect(r.seller).toBe("Dave's Meats (Smith Family Holdings Pty Ltd)")
  })
})
