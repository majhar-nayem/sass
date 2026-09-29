/**
 * The GST included in a GST-inclusive total.
 *
 * One eleventh of each standard-rated line, rounded PER LINE, so GST-free lines — fresh
 * meat, most basic food — are excluded exactly rather than approximately. Zero when the
 * business is not GST-registered: a business under the threshold must not show a GST
 * amount it does not charge.
 *
 * One function because three places need the same answer — the cart, the order, and
 * (M-08) the receipt — and a customer who sees $6.18 GST in their cart and $6.19 on the
 * receipt has been shown two different prices.
 */
export function gstIncludedCents(
  lines: Array<{ lineCents: number; gstFree: boolean }>,
  gstRegistered: boolean,
): number {
  if (!gstRegistered) return 0
  return lines.filter((l) => !l.gstFree).reduce((n, l) => n + Math.round(l.lineCents / 11), 0)
}
