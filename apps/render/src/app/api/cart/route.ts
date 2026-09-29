import { cookies } from 'next/headers'
import { applyCartAction, cartCookie, fulfilmentOptions, gstIncludedCents, loadFulfilment, resolveCart, signCart, storefront, type Cart, type CartAction } from '@awning/commerce'
import { cartSecret, isProduction, NO_STORE, readVisitorCart, sameOrigin, shopForHost } from '@/lib/shop'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * M-05 -- the only thing that reads or writes the cart cookie.
 *
 * This is the half of "works on a CDN-cached page" that matters. The shop and product
 * pages are identical for every visitor and never touch the cookie, so they are safe for
 * Cloudflare to cache. Everything per-visitor happens here, and every response says
 * `private, no-store` — a cached cart response would hand one shopper's cart to the
 * next, and a cached `Set-Cookie` would plant it in their browser.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE })

async function context(req: Request) {
  const host = req.headers.get('host') ?? ''
  const shop = await shopForHost(host)
  if (!shop || !shop.status.enabled) return { error: json({ error: 'No shop here.' }, 404) } as const

  const secret = cartSecret()
  if (!secret) return { error: json({ error: 'The cart is unavailable right now.' }, 503) } as const

  const { cart, name } = await readVisitorCart(shop.siteId, secret)
  return { shop, secret, name, cart } as const
}

/** The cart, plus how it can be got to the customer at its current value. */
async function view(siteId: string, cart: Cart, acceptsOrders: boolean) {
  return storefront(async (db) => {
    const resolved = await resolveCart(db, siteId, cart)
    // Each option carries its own order total and GST, computed here with the real rule:
    // a delivery fee's GST follows the goods it delivers, so the total GST depends on
    // which option is chosen. Computed on the server so the rule never has to ship to
    // the browser (it would drag database code into the client bundle).
    const fulfilment = fulfilmentOptions(await loadFulfilment(db, siteId), resolved.subtotalCents).map((o) => ({
      ...o,
      orderTotalCents: resolved.subtotalCents + o.priceCents,
      orderGstCents: gstIncludedCents(resolved.lines, resolved.gstRegistered, o.priceCents),
    }))
    return { ...resolved, acceptsOrders, fulfilment }
  })
}

export async function GET(req: Request) {
  const c = await context(req)
  if ('error' in c) return c.error
  return json(await view(c.shop.siteId, c.cart, c.shop.status.acceptsOrders))
}

function parseAction(body: unknown): CartAction | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const id = typeof b.productId === 'string' ? b.productId : null
  const qty = typeof b.qty === 'number' && Number.isFinite(b.qty) ? Math.trunc(b.qty) : undefined
  switch (b.action) {
    case 'add':
      return id ? { action: 'add', productId: id, ...(qty !== undefined ? { qty } : {}) } : null
    case 'set':
      return id && qty !== undefined ? { action: 'set', productId: id, qty } : null
    case 'remove':
      return id ? { action: 'remove', productId: id } : null
    case 'clear':
      return { action: 'clear' }
    default:
      return null
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Cross-site request refused.' }, 403)

  const c = await context(req)
  if ('error' in c) return c.error

  let change: CartAction | null = null
  try {
    change = parseAction(await req.json())
  } catch {
    change = null
  }
  if (!change) return json({ error: 'That is not a cart change we understand.' }, 400)

  const { cart, rejected } = await storefront((db) => applyCartAction(db, c.shop.siteId, c.cart, change))
  if (rejected) return json({ error: 'That product is not available.' }, 404)

  const signed = await signCart(cart, c.secret)
  ;(await cookies()).set(c.name, signed, cartCookie(isProduction()).attributes)

  return json(await view(c.shop.siteId, cart, c.shop.status.acceptsOrders))
}
