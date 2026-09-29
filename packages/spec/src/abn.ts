/**
 * The Australian Business Number.
 *
 * Validated by its check digits, not just its length. An ABN is printed in the footer of
 * every site that shows one, and from M-08 on every tax invoice — so a transposed digit
 * is published to the business's customers and lands on documents they use to claim GST
 * credits. Eleven digits is a format; this is a check.
 *
 * Algorithm from the ABR (abr.business.gov.au/Help/AbnFormat): subtract 1 from the first
 * digit, weight each digit, sum, and the ABN is valid when the sum divides by 89.
 */
const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]

/** Digits only — people type ABNs with spaces, and paste them with anything. */
export function normaliseAbn(input: string): string {
  return input.replace(/\D/g, '')
}

export function isValidAbn(input: string | null | undefined): boolean {
  if (!input) return false
  const d = normaliseAbn(input)
  if (d.length !== 11 || d[0] === '0') return false
  const digits = d.split('').map(Number)
  digits[0]! -= 1
  return digits.reduce((sum, digit, i) => sum + digit * WEIGHTS[i]!, 0) % 89 === 0
}

/** "51 824 753 556" — the grouping the ABR itself uses. */
export function formatAbn(input: string): string {
  const d = normaliseAbn(input)
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : input
}
