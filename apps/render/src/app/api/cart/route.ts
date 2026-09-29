import { cookies } from 'next/headers'
import {
  applyCartAction,
  cartCookie,
  emptyCart,
  readCart,
  resolveCart,
  signCart,
  storefront,
  type CartAction,
} from '@awning/commerce'
import { logger } from '@awning/integrations/observability'
import { cartSecret, isProduction, shopForHost } from '@/lib/shop'

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
const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  // Belt and braces for any cache that ignores no-store on a 200.
  Vary: 'Cookie',
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE })

async function context(req: Request) {
  const host = req.headers.get('host') ?? ''
  const shop = await shopForHost(host)
  if (!shop || !shop.status.enabled) return { error: json({ error: 'No shop here.' }, 404) } as const

  const secret = cartSecret()
  if (!secret) return { error: json({ error: 'The cart is unavailable right now.' }, 503) } as const

  const { name } = cartCookie(isProduction())
  const raw = (await cookies()).get(name)?.value
  const read = await readCart(raw, secret, shop.siteId)
  if (!read.ok && read.reason !== 'missing') {
    // Every failure looks the same to a shopper — an empty cart — but not to us. A
    // run of bad signatures is someone probing; a wrong-site cart is a cookie crossing
    // tenants, which should never happen and is worth knowing about if it does.
    logger.warn('cart.rejected', { reason: read.reason, site_id: shop.siteId })
  }
  return { shop, secret, name, cart: read.ok ? read.cart : emptyCart(shop.siteId) } as const
}

export async function GET(req: Request) {
  const c = await context(req)
  if ('error' in c) return c.error
  return json({
    ...(await storefront((db) => resolveCart(db, c.shop.siteId, c.cart))),
    acceptsOrders: c.shop.status.acceptsOrders,
  })
}

/**
 * Until awningsites.com is on the Public Suffix List, every tenant is the SAME SITE as
 * every other tenant as far as a browser is concerned — so SameSite=Lax offers no
 * protection between them, and a page on one tenant's subdomain could post to another's
 * cart. The stakes are small (a ham in someone's basket), the check is one line.
 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // same-origin form posts and non-browser clients
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
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

  return json({
    ...(await storefront((db) => resolveCart(db, c.shop.siteId, cart))),
    acceptsOrders: c.shop.status.acceptsOrders,
  })
}
