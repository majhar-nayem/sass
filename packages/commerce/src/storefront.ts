import { withoutOrgContext, type PrismaTx } from '@awning/db'
import { MAX_QTY, normaliseCart, type Cart } from './cart-cookie.js'
import { gstIncludedCents } from './gst.js'
import { hasAnyFulfilment, type FulfilmentSettings } from './fulfilment.js'

/**
 * M-05 -- what a visitor to a tenant's site can see and buy.
 *
 * Everything here runs without org context, because a shopper has no org: the site is
 * resolved from the Host header and every query is filtered to that site explicitly.
 * That makes the `site_id` in each WHERE the isolation boundary, so it is never
 * optional and never taken from the request body.
 */

export interface ShopStatus {
  /** The shop pages exist at all. */
  enabled: boolean
  /** A visitor could complete an order: payments work and there is something to buy. */
  acceptsOrders: boolean
  reason: 'ok' | 'no-plan' | 'not-published' | 'no-products' | 'payments-not-ready' | 'no-fulfilment'
}

/**
 * The shop's pickup, delivery and post settings.
 *
 * `pickup_address` is JSON with a single `text` field: an address a butcher types, shown
 * to the customer as typed. Structured address fields buy nothing here and cost a form.
 */
export async function loadFulfilment(db: PrismaTx, siteId: string): Promise<FulfilmentSettings> {
  const [st, rates] = await Promise.all([
    db.store_settings.findUnique({
      where: { site_id: siteId },
      select: {
        pickup_enabled: true, pickup_address: true, pickup_instructions: true,
        local_delivery_enabled: true, local_delivery_postcodes: true,
        local_delivery_fee_cents: true, local_delivery_min_cents: true,
      },
    }),
    db.shipping_rates.findMany({
      where: { site_id: siteId, is_active: true, method: 'shipping' },
      orderBy: [{ position: 'asc' }, { price_cents: 'asc' }],
      select: { id: true, name: true, price_cents: true, free_over_cents: true, applies_to_states: true },
    }),
  ])
  const addr = st?.pickup_address as { text?: string } | null | undefined
  return {
    pickup: { enabled: st?.pickup_enabled ?? false, address: addr?.text ?? null, instructions: st?.pickup_instructions ?? null },
    delivery: {
      enabled: st?.local_delivery_enabled ?? false,
      postcodes: st?.local_delivery_postcodes ?? [],
      feeCents: st?.local_delivery_fee_cents ?? 0,
      minCents: st?.local_delivery_min_cents ?? null,
    },
    post: rates.map((r) => ({ id: r.id, name: r.name, priceCents: r.price_cents, freeOverCents: r.free_over_cents, states: r.applies_to_states })),
  }
}

/**
 * The single definition of "this site has a shop".
 *
 * It exists because two places were about to answer it differently. The privacy policy
 * decided a site takes online orders if a store_settings row existed — and the payments
 * screen creates that row just by being opened. So visiting a settings page would have
 * made a customer's published privacy policy claim they take orders and name Stripe as
 * an overseas recipient of personal information.
 */
export async function shopStatus(db: PrismaTx, siteId: string): Promise<ShopStatus> {
  const site = await db.sites.findUnique({
    where: { id: siteId },
    select: {
      status: true,
      store_settings: { select: { stripe_onboarded_at: true } },
      organizations: {
        select: { subscriptions: { select: { status: true, plans: { select: { ecommerce: true } } } } },
      },
    },
  })
  const off = (reason: ShopStatus['reason']): ShopStatus => ({ enabled: false, acceptsOrders: false, reason })
  if (!site || site.status !== 'published') return off('not-published')

  const sub = site.organizations.subscriptions
  // Only the plans that include a shop, and only while the subscription is live. A
  // cancelled store-plan customer keeps a brochure site, not a checkout.
  if (!sub?.plans.ecommerce || !['active', 'trialing', 'past_due'].includes(sub.status)) return off('no-plan')

  const products = await db.products.count({ where: { site_id: siteId, status: 'active' } })
  if (products === 0) return off('no-products')

  // Only M-03's charges_enabled check ever writes this, so it is safe to trust.
  const paymentsReady = !!site.store_settings?.stripe_onboarded_at
  if (!paymentsReady) return { enabled: true, acceptsOrders: false, reason: 'payments-not-ready' }

  // M-09. Taking money for an order nobody has said how to deliver — M-07 was recording
  // every order as "pickup" whether or not the shop had anywhere to pick up from.
  if (!hasAnyFulfilment(await loadFulfilment(db, siteId)))
    return { enabled: true, acceptsOrders: false, reason: 'no-fulfilment' }
  return { enabled: true, acceptsOrders: true, reason: 'ok' }
}

export interface StorefrontProduct {
  id: string
  slug: string
  title: string
  description: string | null
  priceCents: number
  /** Present only when attested (see M-04); the column constraint guarantees it. */
  compareAtCents: number | null
  gstFree: boolean
  category: string | null
  imageUrl: string | null
  /** false when stock is tracked, backorders are off, and there is none left. */
  available: boolean
  /** Only when stock is tracked and low enough to be worth saying. */
  lowStock: number | null
  /**
   * What to say about GST beside the price, or nothing. A business that is not
   * registered does not charge GST, so "Includes GST" on its price would be false —
   * and so would "GST free", which implies GST applies to other things it sells.
   */
  gstNote: 'Includes GST' | 'GST free' | null
}

const productSelect = {
  id: true, slug: true, title: true, description: true, price_cents: true,
  compare_at_cents: true, gst_free: true, track_inventory: true, inventory_qty: true,
  allow_backorder: true,
  product_categories: { select: { name: true } },
  product_images: {
    orderBy: { position: 'asc' as const },
    take: 1,
    select: { site_assets: { select: { public_url: true } } },
  },
  sites: { select: { organizations: { select: { gst_registered: true } } } },
} as const

type ProductRow = {
  id: string; slug: string; title: string; description: string | null; price_cents: number
  compare_at_cents: number | null; gst_free: boolean; track_inventory: boolean
  inventory_qty: number; allow_backorder: boolean
  product_categories: { name: string } | null
  product_images: Array<{ site_assets: { public_url: string } }>
  sites: { organizations: { gst_registered: boolean } }
}

function toStorefront(p: ProductRow): StorefrontProduct {
  const tracked = p.track_inventory && !p.allow_backorder
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    priceCents: p.price_cents,
    compareAtCents: p.compare_at_cents,
    gstFree: p.gst_free,
    category: p.product_categories?.name ?? null,
    imageUrl: p.product_images[0]?.site_assets.public_url ?? null,
    available: !tracked || p.inventory_qty > 0,
    lowStock: tracked && p.inventory_qty > 0 && p.inventory_qty <= 5 ? p.inventory_qty : null,
    gstNote: p.sites.organizations.gst_registered ? (p.gst_free ? 'GST free' : 'Includes GST') : null,
  }
}

/** Drafts are never shown. M-04 imports as draft precisely so nothing leaks early. */
export async function listStorefrontProducts(db: PrismaTx, siteId: string): Promise<StorefrontProduct[]> {
  const rows = await db.products.findMany({
    where: { site_id: siteId, status: 'active' },
    orderBy: [{ position: 'asc' }, { title: 'asc' }],
    take: 500,
    select: productSelect,
  })
  return rows.map((r) => toStorefront(r as ProductRow))
}

export async function storefrontProduct(db: PrismaTx, siteId: string, slug: string): Promise<StorefrontProduct | null> {
  const row = await db.products.findFirst({
    where: { site_id: siteId, slug, status: 'active' },
    select: productSelect,
  })
  return row ? toStorefront(row as ProductRow) : null
}

// ------------------------------------------------------------------------ cart

export interface ResolvedLine {
  productId: string
  slug: string
  title: string
  qty: number
  unitCents: number
  lineCents: number
  gstFree: boolean
  imageUrl: string | null
  /** Set when the quantity asked for was reduced to what is in stock. */
  cappedFrom: number | null
}

export interface ResolvedCart {
  lines: ResolvedLine[]
  /** Items that were in the cookie but can no longer be bought. Shown, not hidden. */
  unavailable: Array<{ productId: string; reason: 'removed' | 'out-of-stock' }>
  itemCount: number
  subtotalCents: number
  /**
   * The GST included in the subtotal: one eleventh of each standard-rated line,
   * rounded per line so GST-free lines (fresh meat, most basic food) are excluded
   * exactly. Zero when the business is not GST-registered — a business under the
   * threshold must not show a GST amount it does not charge.
   */
  gstCents: number
  gstRegistered: boolean
}

/**
 * Turns a cart cookie into something a person can be shown.
 *
 * This is where the cart's integrity actually comes from. Prices are today's prices
 * from the database, products are filtered to THIS site and to active ones, and
 * quantities are capped to stock. Nothing the cookie says about money is believed,
 * because the cookie does not say anything about money.
 */
export async function resolveCart(db: PrismaTx, siteId: string, cart: Cart): Promise<ResolvedCart> {
  const c = normaliseCart(cart)
  const ids = c.lines.map((l) => l.productId)

  const [rows, site] = await Promise.all([
    ids.length
      ? db.products.findMany({
          where: { site_id: siteId, id: { in: ids }, status: 'active' },
          select: productSelect,
        })
      : Promise.resolve([]),
    db.sites.findUnique({ where: { id: siteId }, select: { organizations: { select: { gst_registered: true } } } }),
  ])
  const byId = new Map(rows.map((r) => [r.id, r as ProductRow]))
  const gstRegistered = site?.organizations.gst_registered ?? false

  const lines: ResolvedLine[] = []
  const unavailable: ResolvedCart['unavailable'] = []

  for (const l of c.lines) {
    const p = byId.get(l.productId)
    // Deleted, drafted, or belonging to another site: all the same to a shopper.
    if (!p) {
      unavailable.push({ productId: l.productId, reason: 'removed' })
      continue
    }
    const tracked = p.track_inventory && !p.allow_backorder
    const stock = tracked ? p.inventory_qty : MAX_QTY
    if (stock <= 0) {
      unavailable.push({ productId: l.productId, reason: 'out-of-stock' })
      continue
    }
    const qty = Math.min(l.qty, stock, MAX_QTY)
    lines.push({
      productId: p.id,
      slug: p.slug,
      title: p.title,
      qty,
      unitCents: p.price_cents,
      lineCents: p.price_cents * qty,
      gstFree: p.gst_free,
      imageUrl: p.product_images[0]?.site_assets.public_url ?? null,
      cappedFrom: qty < l.qty ? l.qty : null,
    })
  }

  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0)
  const gstCents = gstIncludedCents(lines, gstRegistered)

  return {
    lines,
    unavailable,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
    subtotalCents,
    gstCents,
    gstRegistered,
  }
}

export type CartAction =
  | { action: 'add'; productId: string; qty?: number }
  | { action: 'set'; productId: string; qty: number }
  | { action: 'remove'; productId: string }
  | { action: 'clear' }

/**
 * Applies a change and returns the new cart.
 *
 * Adding checks the product exists on this site first. The resolver would drop a bogus
 * id on read anyway, but refusing it here keeps an invented id from occupying one of the
 * fifty slots in the cookie.
 */
export async function applyCartAction(
  db: PrismaTx,
  siteId: string,
  cart: Cart,
  change: CartAction,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ cart: Cart; rejected?: 'unknown-product' }> {
  const lines = [...cart.lines]
  const at = (id: string) => lines.findIndex((l) => l.productId === id)

  if (change.action === 'clear') return { cart: { siteId, issuedAt: nowSeconds, lines: [] } }

  if (change.action === 'add') {
    const exists = await db.products.findFirst({
      where: { id: change.productId, site_id: siteId, status: 'active' },
      select: { id: true },
    })
    if (!exists) return { cart, rejected: 'unknown-product' }
    const i = at(change.productId)
    const add = Math.max(1, Math.min(MAX_QTY, change.qty ?? 1))
    if (i >= 0) lines[i] = { productId: change.productId, qty: lines[i]!.qty + add }
    else lines.push({ productId: change.productId, qty: add })
  } else if (change.action === 'set') {
    const i = at(change.productId)
    if (change.qty <= 0) {
      if (i >= 0) lines.splice(i, 1)
    } else if (i >= 0) lines[i] = { productId: change.productId, qty: change.qty }
  } else if (change.action === 'remove') {
    const i = at(change.productId)
    if (i >= 0) lines.splice(i, 1)
  }

  return { cart: normaliseCart({ siteId, issuedAt: nowSeconds, lines }) }
}

/** Convenience for the renderer, which has no org and no transaction of its own. */
export const storefront = <T>(fn: (db: PrismaTx) => Promise<T>) => withoutOrgContext('tenant-resolution', fn)
