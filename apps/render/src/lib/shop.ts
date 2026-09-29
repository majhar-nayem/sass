import { cache } from 'react'
import { resolveTenant } from '@awning/tenancy'
import { shopStatus, storefront, type ShopStatus } from '@awning/commerce'
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
