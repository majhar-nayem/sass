import { createStorefrontCheckout, storefront, type CheckoutRefusal } from '@awning/commerce'
import { checkoutKeyProblem } from '@awning/integrations/stripe-checkout'
import { logger, reportError } from '@awning/integrations/observability'
import { cartSecret, NO_STORE, readVisitorCart, requestOrigin, sameOrigin, shopForHost } from '@/lib/shop'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * M-06 -- send the shopper to Stripe Checkout, on the tenant's account.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE })

/** What a shopper sees. Worded for them, not for us. */
const REFUSED: Record<CheckoutRefusal, [number, string]> = {
  'no-shop': [404, 'There is no shop here.'],
  'not-accepting-orders': [409, 'Online ordering is not open yet. Please ring us to order.'],
  'no-account': [409, 'Online ordering is not open yet. Please ring us to order.'],
  'empty-cart': [400, 'Your cart is empty.'],
  'below-minimum': [400, 'The order total is too small to pay by card. Add another item.'],
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Cross-site request refused.' }, 403)

  const host = req.headers.get('host') ?? ''
  const shop = await shopForHost(host)
  if (!shop?.status.enabled) return json({ error: REFUSED['no-shop'][1] }, 404)

  // Both are platform configuration, not the shopper's problem; say so once, loudly.
  const secret = cartSecret()
  const keyProblem = checkoutKeyProblem()
  if (!secret || keyProblem) {
    if (keyProblem) logger.error('checkout.key_problem', { problem: keyProblem })
    return json({ error: 'Checkout is unavailable right now. Please ring us to order.' }, 503)
  }

  const { cart } = await readVisitorCart(shop.siteId, secret)
  try {
    const r = await storefront((db) => createStorefrontCheckout(db, shop.siteId, cart, requestOrigin(req)))
    if (!r.ok) {
      const [status, message] = REFUSED[r.refusal]
      return json({ error: message, refusal: r.refusal }, status)
    }
    logger.info('checkout.session_created', { site_id: shop.siteId })
    return json({ url: r.url })
  } catch (e) {
    // Most often Stripe refusing the session — a restricted account, or a payment
    // method the tenant has since disabled. Reported, and the shopper is not stranded.
    reportError(e, { step: 'checkout.create', site_id: shop.siteId })
    return json({ error: 'We could not start checkout. Please try again, or ring us to order.' }, 502)
  }
}
