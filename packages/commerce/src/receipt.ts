import { formatAbn, isValidAbn } from '@awning/spec'
import { gstIncludedCents, taxableDeliveryCents } from './gst.js'

/**
 * M-08 -- the receipt, and when it may call itself a tax invoice.
 *
 * Built against the ATO's list (ato.gov.au › GST › Tax invoices, updated 18 Sep 2026).
 * A tax invoice under $1,000 must let the reader determine seven things: that it is
 * meant to be a tax invoice; the seller's identity; the seller's ABN; the date; the
 * items with quantity and price; the GST payable; and "the extent to which each sale on
 * the invoice is a taxable sale". From $1,000 it also needs the buyer's identity.
 *
 * That last of the seven is the acceptance criterion: on a butcher's invoice the fresh
 * meat must read GST-free and the cooked ham must read as including GST. The ATO puts it
 * directly for mixed sales — the invoice "must clearly show which items are taxable".
 *
 * The document only calls itself a tax invoice when every requirement is met. Otherwise
 * it is a receipt, and the owner is told exactly what is missing. A document headed
 * "Tax invoice" that is not one is worse than a receipt: the customer may claim GST
 * credits on it.
 */

export interface ReceiptInput {
  seller: {
    name: string
    legalName?: string | null
    abn?: string | null
    gstRegistered: boolean
  }
  orderNumber: number
  issuedAt: Date
  /** The business's own timezone: a 10pm Adelaide order is not dated tomorrow. */
  timezone?: string
  lines: Array<{ title: string; qty: number; unitCents: number; lineCents: number; gstFree: boolean }>
  totalCents: number
  buyer?: { name?: string | null; email?: string | null }
  /** M-09. A delivery or postage fee, which takes the GST character of the goods. */
  delivery?: { label: string; cents: number } | null
}

export interface ReceiptDelivery {
  label: string
  cents: number
  /** true / false when it follows goods that are all one way; 'part' on a mixed order. */
  taxable: boolean | 'part' | null
  /** The apportioned taxable part, shown when `taxable` is 'part'. */
  taxableCents: number
}

export interface ReceiptLine {
  description: string
  qty: number
  unitCents: number
  lineCents: number
  /** null when the seller is not registered, and GST says nothing about the line. */
  taxable: boolean | null
}

export interface Receipt {
  kind: 'tax-invoice' | 'receipt'
  title: 'Tax invoice' | 'Receipt'
  seller: string
  abn: string | null
  issuedOn: string
  reference: string
  lines: ReceiptLine[]
  delivery: ReceiptDelivery | null
  totalCents: number
  /** Zero for a seller that is not registered, who must not show GST at all. */
  gstCents: number
  gstStatement: string | null
  mixed: boolean
  buyer: string | null
  /** Why this is not a tax invoice. For the OWNER, never shown to the customer. */
  problems: string[]
}

export const BUYER_IDENTITY_FROM_CENTS = 100_000

const money = (c: number) =>
  `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function buildReceipt(input: ReceiptInput): Receipt {
  const { seller } = input
  const registered = seller.gstRegistered
  const problems: string[] = []

  const lines: ReceiptLine[] = input.lines.map((l) => ({
    description: l.title,
    qty: l.qty,
    unitCents: l.unitCents,
    lineCents: l.lineCents,
    taxable: registered ? !l.gstFree : null,
  }))

  const deliveryCents = input.delivery?.cents ?? 0
  const gstCents = gstIncludedCents(input.lines, registered, deliveryCents)
  const anyTaxable = input.lines.some((l) => !l.gstFree)
  const anyFree = input.lines.some((l) => l.gstFree)
  const mixed = registered && anyTaxable && anyFree

  const abnOk = isValidAbn(seller.abn)
  const buyer = input.buyer?.name?.trim() || null

  if (registered) {
    if (!seller.abn) problems.push('There is no ABN on your account, and a tax invoice must show one.')
    else if (!abnOk) problems.push('The ABN on your account does not pass the ABN check, so it cannot go on a tax invoice.')
    if (input.totalCents >= BUYER_IDENTITY_FROM_CENTS && !buyer)
      problems.push('Tax invoices of $1,000 or more must show the buyer, and this order has no customer name.')
  }

  // Only a registered seller issues tax invoices at all. An unregistered one issues a
  // receipt with no GST on it — that is correct, not a problem to report.
  const kind: Receipt['kind'] = registered && problems.length === 0 ? 'tax-invoice' : 'receipt'

  let gstStatement: string | null = null
  if (registered && gstCents > 0) {
    // "Total price includes GST" is the ATO's own wording for when GST is exactly one
    // eleventh of the total — true only when every line is taxable.
    gstStatement = mixed
      ? `GST included on taxable items: ${money(gstCents)}`
      : `Total price includes GST of ${money(gstCents)}`
  }

  let delivery: ReceiptDelivery | null = null
  if (input.delivery && input.delivery.cents > 0) {
    const part = taxableDeliveryCents(input.lines, input.delivery.cents)
    delivery = {
      label: input.delivery.label,
      cents: input.delivery.cents,
      taxable: !registered ? null : !anyTaxable ? false : !anyFree ? true : 'part',
      taxableCents: registered ? part : 0,
    }
  }

  const legal = seller.legalName?.trim()
  return {
    kind,
    title: kind === 'tax-invoice' ? 'Tax invoice' : 'Receipt',
    seller: legal && legal !== seller.name ? `${seller.name} (${legal})` : seller.name,
    // Printed only when it is valid: a failing ABN on a receipt is a wrong ABN published.
    abn: abnOk && seller.abn ? formatAbn(seller.abn) : null,
    issuedOn: input.issuedAt.toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: input.timezone ?? 'Australia/Adelaide',
    }),
    reference: `Order #${input.orderNumber}`,
    lines,
    delivery,
    totalCents: input.totalCents,
    gstCents,
    gstStatement,
    mixed,
    buyer: buyer ?? input.buyer?.email ?? null,
    problems,
  }
}

/** Plain text: it is read in an email, often on a phone. */
export function renderReceiptText(r: Receipt): string {
  const width = 44
  const row = (left: string, right: string) => `${left.slice(0, width - right.length - 1).padEnd(width - right.length)}${right}`
  const out = [
    r.title.toUpperCase(),
    r.seller,
    ...(r.abn ? [`ABN ${r.abn}`] : []),
    `${r.reference} · ${r.issuedOn}`,
    '',
  ]
  for (const l of r.lines) {
    const mark = l.taxable === null ? '' : l.taxable ? '  incl. GST' : '  GST-free'
    const label = `${l.qty} × ${l.description}`
    const amount = money(l.lineCents)
    // Wrapped, never cut. The ATO requires a description of what was sold, and a
    // truncated one ("sausages (marinated") can stop saying what it was.
    if (label.length > width - amount.length - 1) {
      out.push(label)
      out.push(row('', amount) + mark)
    } else out.push(row(label, amount) + mark)
  }
  if (r.delivery) {
    const d = r.delivery
    // On a mixed order the fee is split by the goods it delivers, so the invoice says
    // how much of it carries GST — "the extent to which each sale is taxable".
    const mark =
      d.taxable === null ? '' : d.taxable === 'part' ? `  ${money(d.taxableCents)} taxable` : d.taxable ? '  incl. GST' : '  GST-free'
    out.push(row(d.label, money(d.cents)) + mark)
  }
  out.push('', row('Total', money(r.totalCents)))
  if (r.gstStatement) out.push(r.gstStatement)
  if (r.buyer) out.push('', `Billed to: ${r.buyer}`)
  return out.join('\n')
}
