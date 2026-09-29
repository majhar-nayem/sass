import { cache } from 'react'
import { cookies } from 'next/headers'
import { resolveTenant } from '@awning/tenancy'
import { cartCookie, emptyCart, readCart, shopStatus, storefront, type Cart, type ShopStatus } from '@awning/commerce'
import { logger } from '@awning/integrations/observability'

/**
 * M-05 -- the renderer's view of a tenant's shop.
 */
/**
 * Per-request memoised, like loadSiteByHost. `generateMetadata` and the page component
 * both need it, and without this every shop page resolves the shop twice.
 */
export const shopForHost = cache(async function shopForHost(
  host: string,
): Promise<{ siteId: string; orgId: string; status: ShopStatus } | null> {
  const tenant = await resolveTenant(host)
  if (!tenant) return null
  const status = await storefront((db) => shopStatus(db, tenant.siteId))
  return { siteId: tenant.siteId, orgId: tenant.orgId, status }
})

const DEV_SECRET = 'dev-only-cart-secret-not-for-production'

/**
 * The cart signing secret.
 *
 * Missing in production is a refusal, not a fallback: an unsigned or default-signed
 * cart would still be priced from the database — the signature is not what protects
 * the money — but a known secret lets anyone mint carts for any site, and "we have a
 * signature" should not quietly mean "we have a signature everyone knows".
 */
export function cartSecret(): string | null {
  const s = process.env.CART_SECRET
  if (s && s.length >= 32) return s
  if (process.env.NODE_ENV === 'production') {
    logger.error('cart.secret_missing', { hint: 'set CART_SECRET (32+ chars) on the renderer' })
    return null
  }
  return DEV_SECRET
}

export const isProduction = () => process.env.NODE_ENV === 'production'

// ---------------------------------------------------------------------------------
// Shared by /api/cart and /api/checkout, so the security checks exist exactly once.

export const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
} as const

/**
 * Until awningsites.com is on the Public Suffix List, every tenant is the SAME SITE as
 * every other tenant to a browser, so SameSite=Lax gives no protection between them. A
 * page on one tenant's subdomain could post to another's cart or checkout.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // same-origin form posts and non-browser clients
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

/**
 * The origin to send a shopper back to. The host has already resolved to a tenant with
 * a shop by the time this is used, so it is one of our tenant hostnames and not
 * something a request can steer elsewhere.
 */
export function requestOrigin(req: Request): string {
  const host = req.headers.get('host') ?? ''
  const proto = req.headers.get('x-forwarded-proto') ?? (isProduction() ? 'https' : 'http')
  return `${proto}://${host}`
}

export async function readVisitorCart(siteId: string, secret: string): Promise<{ cart: Cart; name: string }> {
  const { name } = cartCookie(isProduction())
  const raw = (await cookies()).get(name)?.value
  const read = await readCart(raw, secret, siteId)
  if (!read.ok && read.reason !== 'missing') {
    // Every failure looks the same to a shopper — an empty cart — but not to us. A
    // run of bad signatures is someone probing; a wrong-site cart is a cookie crossing
    // tenants, which should never happen and is worth knowing about if it does.
    logger.warn('cart.rejected', { reason: read.reason, site_id: siteId })
  }
  return { cart: read.ok ? read.cart : emptyCart(siteId), name }
}
