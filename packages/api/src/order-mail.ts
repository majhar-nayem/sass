import type { PrismaTx } from '@awning/db'
import { sendMail } from '@awning/integrations/mail'

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
      order_items: { select: { title: true, quantity: true, line_total_cents: true } },
      sites: {
        select: {
          name: true, business_email: true, business_phone: true,
          organizations: { select: { billing_email: true, gst_registered: true } },
        },
      },
    },
  })
  if (!o) return { owner: false, customer: false }

  const lines = o.order_items.map((i) => `  ${i.quantity} × ${i.title}`.padEnd(40) + money(i.line_total_cents))
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
        'Get in touch with them to arrange collection or delivery.',
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
        '',
        ...lines,
        '',
        total,
        '',
        `${o.sites.name} will be in touch about collection or delivery.`,
        ...(o.sites.business_phone ? [`Questions? Ring them on ${o.sites.business_phone}.`] : []),
        '',
        // Not a tax invoice, and it does not pretend to be one: that needs an ABN and
        // specific wording, and is M-08's job. Stripe sends the payment receipt.
        'This is an order confirmation. Your payment receipt comes separately from Stripe.',
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
