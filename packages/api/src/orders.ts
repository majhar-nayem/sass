import type Stripe from 'stripe'
import type { PrismaTx } from '@awning/db'
import { gstIncludedCents } from '@awning/commerce'
import { stripe } from '@awning/integrations/stripe'
import { logger } from '@awning/integrations/observability'

/**
 * M-07 -- turning a paid Checkout Session into an order.
 *
 * The rule everything here serves: the money has already been taken. So a paid order is
 * never refused. A product deleted since checkout becomes an order line with no product.
 * Stock that runs out becomes negative stock that is flagged to the owner — throwing on
 * an oversell would fail the webhook, Stripe would retry it forever, and a customer who
 * paid would have no order at all. A missing email is recorded as missing.
 */

export interface PaidLine {
  /** Ours, from the session metadata. Checked against THIS site before it is trusted. */
  productId: string | null
  title: string
  qty: number
  unitCents: number
  lineCents: number
  /** As quoted at checkout (M-06 put it in the metadata), not as the product reads now. */
  gstFree: boolean
}

export interface SessionSnapshot {
  sessionId: string
  paymentIntentId: string | null
  accountId: string
  /** What the session CLAIMS about itself. Verified against the account before use. */
  claimedSiteId: string | null
  isOurs: boolean
  paymentStatus: Stripe.Checkout.Session.PaymentStatus
  email: string | null
  name: string | null
  phone: string | null
  subtotalCents: number
  totalCents: number
  lines: PaidLine[]
  /** M-09. How the customer is getting it, as chosen and checked before payment. */
  fulfilment: 'pickup' | 'local_delivery' | 'shipping'
  fulfilmentLabel: string | null
  shipTo: Record<string, string | null> | null
  deliveryCents: number
}

/**
 * Everything the order needs from Stripe, fetched BEFORE the transaction.
 *
 * The event carries the session but not its line items, and the line items are the
 * record of what was actually charged. Fetching them inside the transaction would hold
 * row locks for as long as Stripe takes to answer.
 */
export async function snapshotSession(accountId: string, session: Stripe.Checkout.Session): Promise<SessionSnapshot> {
  const items = await stripe().checkout.sessions.listLineItems(
    session.id,
    { limit: 100, expand: ['data.price.product'] },
    { stripeAccount: accountId },
  )
  return snapshotFrom(accountId, session, items.data)
}

/** Pure, so the mapping is testable without a network. */
export function snapshotFrom(
  accountId: string,
  session: Stripe.Checkout.Session,
  items: Stripe.LineItem[],
): SessionSnapshot {
  const metaOf = (li: Stripe.LineItem) => {
    const product = li.price?.product
    return product && typeof product === 'object' && !('deleted' in product && product.deleted) ? product.metadata : {}
  }
  // The delivery fee travels as its own line (see M-06/M-09). It is not goods: it has no
  // stock, and its GST follows the goods it delivers.
  const isFee = (li: Stripe.LineItem) => metaOf(li)?.kind === 'fulfilment'
  const goods = items.filter((li) => !isFee(li))
  const deliveryCents = items.filter(isFee).reduce((n, li) => n + (li.amount_total ?? 0), 0)
  const method = session.metadata?.fulfilment
  let shipTo: Record<string, string | null> | null = null
  try {
    shipTo = session.metadata?.ship_to ? JSON.parse(session.metadata.ship_to) : null
  } catch {
    shipTo = null
  }

  return {
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
    accountId,
    claimedSiteId: (session.metadata?.site_id as string | undefined) ?? null,
    // A connected Standard account is the tenant's own. Connect delivers EVERY session
    // on it — including sales they make through Stripe outside Awning — and those must
    // not appear as orders on their website.
    isOurs: session.metadata?.platform === 'awning',
    paymentStatus: session.payment_status,
    email: session.customer_details?.email ?? null,
    name: session.customer_details?.name ?? null,
    phone: session.customer_details?.phone ?? null,
    subtotalCents: session.amount_subtotal ?? 0,
    totalCents: session.amount_total ?? 0,
    fulfilment: method === 'local_delivery' || method === 'shipping' ? method : 'pickup',
    fulfilmentLabel: (session.metadata?.fulfilment_label as string | undefined) ?? null,
    shipTo,
    deliveryCents,
    lines: goods.map((li) => {
      const meta = metaOf(li)
      const qty = li.quantity ?? 1
      return {
        productId: meta?.product_id ?? null,
        title: li.description ?? 'Item',
        qty,
        unitCents: li.price?.unit_amount ?? Math.round((li.amount_total ?? 0) / qty),
        lineCents: li.amount_total ?? 0,
        gstFree: meta?.gst_free === '1',
      }
    }),
  }
}

export type OrderOutcome =
  | { kind: 'created-paid'; orderId: string; orderNumber: number; oversold: Array<{ title: string; by: number }> }
  | { kind: 'created-pending'; orderId: string; orderNumber: number }
  | { kind: 'marked-paid'; orderId: string; orderNumber: number; oversold: Array<{ title: string; by: number }> }
  | { kind: 'cancelled'; orderId: string }
  | { kind: 'already'; orderId: string }
  | { kind: 'ignored'; reason: 'not-ours' | 'site-mismatch' | 'no-order' }

/**
 * Records the order, once, inside the caller's transaction.
 *
 * `want` is where the event says this session has got to: 'paid' (card, and Afterpay
 * once approved), 'pending' (an asynchronous method still deciding), or 'cancelled'
 * (that method said no).
 *
 * Stock moves only on the transition INTO paid, and that transition happens once, under
 * a per-site advisory lock, in the same transaction as the order row. So a duplicated
 * webhook — or a `completed` and an `async_payment_succeeded` for the same session, in
 * either order, at the same moment — creates one order and decrements once.
 */
export async function recordOrder(
  db: PrismaTx,
  siteId: string,
  snap: SessionSnapshot,
  want: 'paid' | 'pending' | 'cancelled',
): Promise<OrderOutcome> {
  if (!snap.isOurs) return { kind: 'ignored', reason: 'not-ours' }
  // The account decides the site; the metadata only has to agree. A tenant owns their
  // Stripe account and could create a session claiming to be any site at all.
  if (snap.claimedSiteId !== siteId) return { kind: 'ignored', reason: 'site-mismatch' }

  // Serialises order creation for this site: order numbers, and the paid transition.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`orders:${siteId}`}))`

  const existing = await db.orders.findUnique({
    where: { stripe_checkout_session_id: snap.sessionId },
    select: { id: true, status: true, order_number: true },
  })

  if (want === 'cancelled') {
    if (!existing) return { kind: 'ignored', reason: 'no-order' }
    if (existing.status !== 'pending') return { kind: 'already', orderId: existing.id }
    await db.orders.update({ where: { id: existing.id }, data: { status: 'cancelled', cancelled_at: new Date() } })
    return { kind: 'cancelled', orderId: existing.id }
  }

  if (existing) {
    if (want === 'paid' && existing.status === 'pending') {
      await db.orders.update({
        where: { id: existing.id },
        data: { status: 'paid', paid_at: new Date(), stripe_payment_intent_id: snap.paymentIntentId },
      })
      const oversold = await decrementStock(db, siteId, existing.id)
      return { kind: 'marked-paid', orderId: existing.id, orderNumber: existing.order_number, oversold }
    }
    return { kind: 'already', orderId: existing.id }
  }

  // Only link lines to products that exist ON THIS SITE. The metadata came from us, but
  // the account it lives on is the tenant's, and a product id they wrote there must not
  // reach another tenant's catalogue — or fail a foreign key and lose a paid order.
  const claimed = snap.lines.map((l) => l.productId).filter((x): x is string => !!x && isUuid(x))
  const real = new Set(
    claimed.length
      ? (await db.products.findMany({ where: { site_id: siteId, id: { in: claimed } }, select: { id: true } })).map((p) => p.id)
      : [],
  )

  const org = await db.sites.findUnique({
    where: { id: siteId },
    select: { organizations: { select: { gst_registered: true } } },
  })
  // Delivery apportioned by the goods it delivers (GSTR 2001/8 — see commerce/gst).
  const gstCents = gstIncludedCents(snap.lines, org?.organizations.gst_registered ?? false, snap.deliveryCents)

  const last = await db.orders.aggregate({ where: { site_id: siteId }, _max: { order_number: true } })
  const orderNumber = (last._max.order_number ?? 0) + 1

  if (!snap.email) logger.warn('orders.no_email', { site_id: siteId })

  const order = await db.orders.create({
    data: {
      site_id: siteId,
      order_number: orderNumber,
      status: want === 'paid' ? 'paid' : 'pending',
      // Goods only. The delivery fee is its own column so the receipt can show it.
      subtotal_cents: snap.subtotalCents - snap.deliveryCents,
      shipping_cents: snap.deliveryCents,
      total_cents: snap.totalCents,
      gst_cents: gstCents,
      fulfilment: snap.fulfilment,
      ship_to: (snap.shipTo ?? undefined) as never,
      notes: snap.fulfilmentLabel,
      email: snap.email ?? '',
      phone: snap.phone,
      customer_name: snap.name,
      stripe_account_id: snap.accountId,
      stripe_checkout_session_id: snap.sessionId,
      stripe_payment_intent_id: snap.paymentIntentId,
      paid_at: want === 'paid' ? new Date() : null,
      order_items: {
        create: snap.lines.map((l) => ({
          product_id: l.productId && real.has(l.productId) ? l.productId : null,
          title: l.title.slice(0, 200),
          unit_price_cents: l.unitCents,
          quantity: l.qty,
          line_total_cents: l.lineCents,
          gst_free: l.gstFree,
        })),
      },
    },
    select: { id: true },
  })

  if (want === 'pending') return { kind: 'created-pending', orderId: order.id, orderNumber }
  const oversold = await decrementStock(db, siteId, order.id)
  return { kind: 'created-paid', orderId: order.id, orderNumber, oversold }
}

/**
 * Takes the order's quantities off the shelf. Never refuses: stock below zero is a real
 * oversell that the owner must hear about, and hiding it by stopping at zero would leave
 * them promising a ham they do not have.
 */
async function decrementStock(db: PrismaTx, siteId: string, orderId: string) {
  const items = await db.order_items.findMany({
    where: { order_id: orderId, product_id: { not: null } },
    select: { product_id: true, quantity: true, title: true },
  })
  const oversold: Array<{ title: string; by: number }> = []
  for (const it of items) {
    const rows = await db.$queryRaw<Array<{ inventory_qty: number; allow_backorder: boolean }>>`
      UPDATE products SET inventory_qty = inventory_qty - ${it.quantity}, updated_at = now()
      WHERE id = ${it.product_id}::uuid AND site_id = ${siteId}::uuid AND track_inventory
      RETURNING inventory_qty, allow_backorder`
    const r = rows[0]
    if (r && r.inventory_qty < 0 && !r.allow_backorder) oversold.push({ title: it.title, by: -r.inventory_qty })
  }
  if (oversold.length) logger.warn('orders.oversold', { site_id: siteId, order_id: orderId, lines: oversold.length })
  return oversold
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
