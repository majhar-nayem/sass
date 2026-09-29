/**
 * The GST included in a GST-inclusive total, by the ATO's "total invoice rule".
 *
 * Add up the GST-inclusive price of every TAXABLE line, take one eleventh, and round
 * once to the nearest cent, half a cent upwards. GST-free lines — fresh meat, most basic
 * food — are left out of the sum entirely.
 *
 * Corrected in M-08. This first rounded each line and then added them, with a comment
 * claiming that was needed "so GST-free lines are excluded exactly". It was not:
 * excluding GST-free lines is a filter, not a rounding choice. Per-line rounding drifts
 * by up to half a cent a line, so a fifty-line order could be out by 25 cents; rounding
 * the total is never more than half a cent from exact. Both rules are permitted — the
 * ATO says seller and customer "don't need to use the same rounding rules" — but this is
 * the one a customer with a calculator reproduces.
 *
 * (ato.gov.au › GST › Tax invoices › Rounding of GST.)
 *
 * One function, because three places need the same answer — the cart, the order, and
 * the receipt — and a customer shown $6.18 GST in the cart and $6.19 on the invoice has
 * been shown two different prices.
 */
export function gstIncludedCents(
  lines: Array<{ lineCents: number; gstFree: boolean }>,
  gstRegistered: boolean,
  deliveryCents = 0,
): number {
  if (!gstRegistered) return 0
  return Math.round(taxableValue(lines, deliveryCents) / 11)
}

/**
 * The GST-inclusive value of the taxable part of an order, delivery included.
 *
 * Delivery takes the GST character of the goods it delivers (M-09). The ATO's ruling on
 * mixed and composite supplies, GSTR 2001/8, paragraph 77: a business delivering
 * GST-free food to the customer's door "is making a supply of delivered GST-free goods,
 * and has no liability to account for GST on the delivery of them" — the delivery is
 * "integral, ancillary or incidental". So:
 *
 *  - all goods GST-free → the delivery fee is GST-free
 *  - all goods taxable  → the delivery fee is taxable
 *  - a mix              → the fee is apportioned by the goods' relative value, which the
 *                         same ruling (paragraph 98) accepts as a reasonable method
 *
 * The natural shortcut — delivery is always taxable — over-reports GST for every butcher
 * who delivers fresh meat. The opposite under-reports on a mixed order.
 *
 * Returned unrounded: it feeds the single rounding in gstIncludedCents.
 */
export function taxableValue(lines: Array<{ lineCents: number; gstFree: boolean }>, deliveryCents = 0): number {
  const goods = lines.reduce((n, l) => n + l.lineCents, 0)
  const taxableGoods = lines.filter((l) => !l.gstFree).reduce((n, l) => n + l.lineCents, 0)
  if (goods === 0) return 0
  return taxableGoods + (deliveryCents * taxableGoods) / goods
}

/** The part of a delivery fee that is taxable, in cents, for showing on the receipt. */
export function taxableDeliveryCents(lines: Array<{ lineCents: number; gstFree: boolean }>, deliveryCents: number): number {
  const goods = lines.reduce((n, l) => n + l.lineCents, 0)
  if (goods === 0 || deliveryCents === 0) return 0
  const taxableGoods = lines.filter((l) => !l.gstFree).reduce((n, l) => n + l.lineCents, 0)
  return Math.round((deliveryCents * taxableGoods) / goods)
}
