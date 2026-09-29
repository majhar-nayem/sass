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
): number {
  if (!gstRegistered) return 0
  const taxableCents = lines.filter((l) => !l.gstFree).reduce((n, l) => n + l.lineCents, 0)
  // Integer cents throughout, so the only rounding is this one — and Math.round rounds
  // a positive half upwards, which is the ATO's rule.
  return Math.round(taxableCents / 11)
}
