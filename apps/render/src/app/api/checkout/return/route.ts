import { cookies } from 'next/headers'
import { storefront, verifyCheckoutReturn } from '@awning/commerce'
import { logger } from '@awning/integrations/observability'
import { cartSecret, NO_STORE, readVisitorCart, requestOrigin, shopForHost } from '@/lib/shop'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * M-06 -- where Stripe sends a shopper after checkout.
 *
 * Arriving here proves nothing: it is a redirect with a session id in the query
 * string, and anyone can type it. So the session is checked with Stripe, on this
 * site's own account, before the cart is emptied or the shopper is told it worked.
 *
 * It fulfils nothing. Orders are created from the webhook (M-07), because a shopper who
 * pays and closes the tab never makes this request at all.
 */
export async function GET(req: Request) {
  const origin = requestOrigin(req)
  const to = (path: string) => new Response(null, { status: 303, headers: { ...NO_STORE, Location: `${origin}${path}` } })

  const shop = await shopForHost(req.headers.get('host') ?? '')
  if (!shop?.status.enabled) return to('/')

  const sessionId = new URL(req.url).searchParams.get('session_id') ?? ''
  const outcome = await storefront((db) => verifyCheckoutReturn(db, shop.siteId, sessionId))
  logger.info('checkout.returned', { site_id: shop.siteId, outcome })

  if (outcome === 'paid') {
    // Only now is the cart emptied. Clearing it on a mere redirect would lose a
    // shopper's basket every time an Afterpay decision was still pending.
    const secret = cartSecret()
    if (secret) {
      const { name } = await readVisitorCart(shop.siteId, secret)
      ;(await cookies()).delete(name)
    }
    return to('/checkout/thanks')
  }
  if (outcome === 'pending') return to('/checkout/thanks?pending=1')
  // Unknown or someone else's session: back to the cart, which is still intact.
  return to('/cart')
}
