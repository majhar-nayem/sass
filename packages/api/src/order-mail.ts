import type { PrismaTx } from '@awning/db'
import { sendMail } from '@awning/integrations/mail'
import { buildReceipt, renderReceiptText } from '@awning/commerce'

/**
 * M-07 -- telling the butcher, and telling the customer.
 *
 * Sent AFTER the order commits, never inside it: a mail provider blipping must not
 * roll back an order someone has paid for. The cost of that ordering is that a send can
 * fail with the order safely recorded and nobody told — which is why each send stamps
 * its own `*_notified_at` only when it succeeds, and the daily digest counts the ones
 * that did not.
 */
const money = (c: number) => `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Long enough to send two emails; short enough that a crashed sender is soon replaced. */
const LEASE_SECONDS = 120

export async function notifyOrder(
  db: PrismaTx,
  orderId: string,
  oversold: Array<{ title: string; by: number }> = [],
): Promise<{ owner: boolean; customer: boolean; skipped?: 'in-progress-or-done' }> {
  // Take the lease, atomically. Only a sender that wins it sends anything; the rest
  // walk away. Without this, simultaneous duplicates each read "not yet notified" and
  // each sent — the owner got four "New order" emails for one order.
  const won = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE orders SET notify_lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE id = ${orderId}::uuid
      AND status = 'paid'
      AND (notify_lease_until IS NULL OR notify_lease_until < now())
      AND (owner_notified_at IS NULL OR (customer_notified_at IS NULL AND email <> ''))
    RETURNING id`
  if (won.length === 0) return { owner: false, customer: false, skipped: 'in-progress-or-done' }

  try {
    return await send(db, orderId, oversold)
  } finally {
    // Released either way. A failed send leaves its stamp unset, so the next attempt —
    // a redelivered webhook, or the cron sweep — picks up exactly what is missing.
    await db.orders.update({ where: { id: orderId }, data: { notify_lease_until: null } })
  }
}

async function send(
  db: PrismaTx,
  orderId: string,
  oversold: Array<{ title: string; by: number }>,
): Promise<{ owner: boolean; customer: boolean }> {
  const o = await db.orders.findUnique({
    where: { id: orderId },
    select: {
      order_number: true, total_cents: true, gst_cents: true, email: true, phone: true,
      customer_name: true, owner_notified_at: true, customer_notified_at: true,
      paid_at: true, created_at: true,
      fulfilment: true, ship_to: true, shipping_cents: true, notes: true,
      order_items: {
        select: { title: true, quantity: true, unit_price_cents: true, line_total_cents: true, gst_free: true },
      },
      sites: {
        select: {
          name: true, business_email: true, business_phone: true,
          store_settings: { select: { pickup_address: true, pickup_instructions: true } },
          organizations: {
            select: { billing_email: true, gst_registered: true, abn: true, legal_name: true, timezone: true },
          },
        },
      },
    },
  })
  if (!o) return { owner: false, customer: false }

  const lines = o.order_items.map((i) => `  ${i.quantity} × ${i.title}`.padEnd(40) + money(i.line_total_cents))
  const org = o.sites.organizations
  // M-08. The customer's copy IS the receipt — a tax invoice when every ATO requirement
  // is met, otherwise a receipt, with the reason given to the owner below.
  const receipt = buildReceipt({
    seller: { name: o.sites.name, legalName: org.legal_name, abn: org.abn, gstRegistered: org.gst_registered },
    orderNumber: o.order_number,
    issuedAt: o.paid_at ?? o.created_at,
    timezone: org.timezone,
    lines: o.order_items.map((i) => ({
      title: i.title, qty: i.quantity, unitCents: i.unit_price_cents, lineCents: i.line_total_cents, gstFree: i.gst_free,
    })),
    totalCents: o.total_cents,
    buyer: { name: o.customer_name, email: o.email || null },
    delivery: o.shipping_cents > 0 ? { label: o.notes ?? 'Delivery', cents: o.shipping_cents } : null,
  })

  // M-09. What was arranged, instead of "the owner will be in touch".
  const shipTo = o.ship_to as { name?: string; line1?: string; line2?: string | null; suburb?: string; state?: string; postcode?: string } | null
  const addressText = shipTo
    ? [shipTo.name, shipTo.line1, shipTo.line2, `${shipTo.suburb ?? ''} ${shipTo.state ?? ''} ${shipTo.postcode ?? ''}`.trim()]
        .filter(Boolean)
        .join('\n')
    : null
  const pickupAt = (o.sites.store_settings?.pickup_address as { text?: string } | null)?.text ?? null
  const pickupHow = o.sites.store_settings?.pickup_instructions ?? null
  const isPickup = o.fulfilment === 'pickup'
  const total = `Total ${money(o.total_cents)}${o.sites.organizations.gst_registered && o.gst_cents > 0 ? ` (includes ${money(o.gst_cents)} GST)` : ''}`
  const ownerTo = o.sites.business_email ?? o.sites.organizations.billing_email

  let owner = !!o.owner_notified_at
  if (!owner && ownerTo) {
    const r = await sendMail({
      kind: 'tenant',
      to: ownerTo,
      // The phone number in the subject is actionable from a lock screen — the same
      // reason the enquiry email puts it there.
      subject: `New order #${o.order_number}${o.phone ? ` — ${o.phone}` : ''}${o.customer_name ? ` (${o.customer_name})` : ''}`,
      text: [
        `New order #${o.order_number} from your website. It is paid.`,
        '',
        // First, because it decides what happens next: box it for the counter, or load
        // the van.
        ...(isPickup ? ['PICKUP — they will come to you.'] : [`${o.notes?.toUpperCase() ?? 'DELIVER'} — deliver to:`, addressText ?? '(no address recorded)']),
        '',
        ...(oversold.length
          ? [
              'OVERSOLD — you have sold more than your recorded stock:',
              ...oversold.map((x) => `  ${x.title}: short by ${x.by}`),
              'Ring the customer before you promise these.',
              '',
            ]
          : []),
        ...lines,
        '',
        total,
        '',
        `Name:    ${o.customer_name ?? '—'}`,
        `Phone:   ${o.phone ?? '—'}`,
        `Email:   ${o.email || '—'}`,
        '',
        isPickup ? 'Let them know when it is ready to collect.' : 'Let them know when it is on its way.',
        ...(receipt.problems.length
          ? [
              '',
              'Your customer was sent a receipt, not a tax invoice, because:',
              ...receipt.problems.map((p) => `  - ${p}`),
              'Fix this in Settings so the next one is a valid tax invoice.',
            ]
          : []),
      ].join('\n'),
      ...(o.email ? { replyTo: o.email } : {}),
    })
    if (r.sent) {
      await db.orders.update({ where: { id: orderId }, data: { owner_notified_at: new Date() } })
      owner = true
    }
  }

  let customer = !!o.customer_notified_at
  if (!customer && o.email) {
    const r = await sendMail({
      kind: 'tenant',
      to: o.email,
      fromName: o.sites.name,
      subject: `Your order from ${o.sites.name} (#${o.order_number})`,
      text: [
        `Thanks${o.customer_name ? `, ${o.customer_name.split(' ')[0]}` : ''} — ${o.sites.name} has your order.`,
        ...(isPickup
          ? ['Collect it from:', pickupAt ?? o.sites.name, ...(pickupHow ? [pickupHow] : []), `${o.sites.name} will let you know when it is ready.`]
          : ['Delivering to:', addressText ?? '(your address)', `${o.sites.name} will let you know when it is on its way.`]),
        ...(o.sites.business_phone ? [`Questions? Ring them on ${o.sites.business_phone}.`] : []),
        '',
        '────────────────────────────────────────────',
        renderReceiptText(receipt),
        '────────────────────────────────────────────',
        '',
        receipt.kind === 'tax-invoice'
          ? 'Keep this email: it is your tax invoice.'
          : `Need a tax invoice? Reply to this email and ${o.sites.name} can send one.`,
      ].join('\n'),
      ...(o.sites.business_email ? { replyTo: o.sites.business_email } : {}),
    })
    if (r.sent) {
      await db.orders.update({ where: { id: orderId }, data: { customer_notified_at: new Date() } })
      customer = true
    }
  }

  return { owner, customer }
}

/**
 * The backstop the webhook cannot be. Stripe does not redeliver an event we answered
 * 200, so a mail that failed after a successful webhook would otherwise wait for a human
 * to read the digest. Run by the cron sweep; safe alongside a webhook doing the same,
 * because both go through the lease.
 */
export async function retryUnnotifiedOrders(db: PrismaTx, now = new Date()): Promise<{ attempted: number; ownerSent: number }> {
  const pending = await db.orders.findMany({
    where: {
      status: 'paid',
      owner_notified_at: null,
      // Two days is long enough to ride out an outage, short enough not to email a
      // butcher about an order they dealt with by phone last week.
      created_at: { gte: new Date(now.getTime() - 48 * 3600_000) },
    },
    select: { id: true },
    take: 200,
  })
  let ownerSent = 0
  for (const { id } of pending) if ((await notifyOrder(db, id)).owner) ownerSent++
  return { attempted: pending.length, ownerSent }
}
