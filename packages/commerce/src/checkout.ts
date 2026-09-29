import type Stripe from 'stripe'
import type { PrismaTx } from '@awning/db'
import { checkoutStripe } from '@awning/integrations/stripe-checkout'
import { resolveCart, shopStatus, type ResolvedCart } from './storefront.js'
import type { Cart } from './cart-cookie.js'

/**
 * M-06 -- Stripe Checkout, on the tenant's own account.
 *
 * The acceptance criterion is "a test payment settles to the tenant's account, not
 * yours", and the whole of that is one argument: `{ stripeAccount }` on the create
 * call. With it, this is a direct charge on the connected account — the money is the
 * butcher's, the refunds and chargebacks are the butcher's, and Awning is a software
 * vendor. Without it, the same code takes the payment into the PLATFORM balance, and
 * Awning is holding a stranger's Christmas ham money with the regulatory weight that
 * carries (docs/06-COMMERCE-BILLING.md §3). There is no error either way. So it is
 * asserted, and mutation-tested, rather than trusted.
 */

/** Stripe's minimum charge in AUD. Below this Checkout refuses the session outright. */
export const MIN_CHARGE_CENTS = 50

export type CheckoutRefusal =
  | 'no-shop'
  | 'not-accepting-orders'
  | 'empty-cart'
  | 'below-minimum'
  | 'no-account'

export interface CheckoutContext {
  siteId: string
  accountId: string
  /** The tenant host the shopper is on, so they come back to the same site. */
  origin: string
  businessName: string
}

/**
 * The parameters for the session, as a pure function of the resolved cart.
 *
 * Prices come from `resolveCart`, which read them from the database moments ago —
 * never from the cookie, which does not carry any.
 */
export function buildCheckoutParams(
  cart: ResolvedCart,
  ctx: CheckoutContext,
): { params: Stripe.Checkout.SessionCreateParams; options: Stripe.RequestOptions } {
  return {
    params: {
      mode: 'payment',
      line_items: cart.lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: 'aud',
          unit_amount: l.unitCents,
          product_data: {
            name: l.title,
            // M-07 maps paid lines back to our products to decrement stock, and records
            // the GST treatment the customer was actually quoted — not whatever the
            // product says by the time the webhook lands. The session is the record of
            // what was charged.
            metadata: { product_id: l.productId, gst_free: l.gstFree ? '1' : '0' },
          },
        },
      })),
      // No payment_method_types. Stripe's dynamic payment methods show whatever the
      // TENANT has switched on in their own Stripe dashboard — Afterpay included, when
      // the order is within Afterpay's limits. Hard-coding a list would override the
      // tenant's own settings on their own account.
      metadata: { site_id: ctx.siteId, platform: 'awning' },
      payment_intent_data: { metadata: { site_id: ctx.siteId } },
      // A butcher rings about pickup. The number goes into THEIR Stripe account, and
      // the privacy policy already says orders collect contact details.
      phone_number_collection: { enabled: true },
      billing_address_collection: 'auto',
      submit_type: 'pay',
      // Checkout replaces {CHECKOUT_SESSION_ID} itself. The return handler verifies
      // the session with Stripe; the redirect on its own proves nothing.
      success_url: `${ctx.origin}/api/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ctx.origin}/cart`,
    },
    options: { stripeAccount: ctx.accountId },
  }
}

/**
 * Creates a Checkout Session for this visitor's cart, or says why not.
 *
 * Re-resolves the cart here rather than trusting what the cart page showed: prices and
 * stock may have moved since, and this is the last moment before money changes hands.
 */
export async function createStorefrontCheckout(
  db: PrismaTx,
  siteId: string,
  cart: Cart,
  origin: string,
): Promise<{ ok: true; url: string; sessionId: string } | { ok: false; refusal: CheckoutRefusal }> {
  const status = await shopStatus(db, siteId)
  if (!status.enabled) return { ok: false, refusal: 'no-shop' }
  if (!status.acceptsOrders) return { ok: false, refusal: 'not-accepting-orders' }

  const settings = await db.store_settings.findUnique({
    where: { site_id: siteId },
    select: { stripe_account_id: true, sites: { select: { name: true } } },
  })
  if (!settings?.stripe_account_id) return { ok: false, refusal: 'no-account' }

  const resolved = await resolveCart(db, siteId, cart)
  if (resolved.lines.length === 0) return { ok: false, refusal: 'empty-cart' }
  if (resolved.subtotalCents < MIN_CHARGE_CENTS) return { ok: false, refusal: 'below-minimum' }

  const { params, options } = buildCheckoutParams(resolved, {
    siteId,
    accountId: settings.stripe_account_id,
    origin,
    businessName: settings.sites.name,
  })
  const session = await checkoutStripe().checkout.sessions.create(params, options)
  if (!session.url) throw new Error('Stripe returned a checkout session with no URL.')
  return { ok: true, url: session.url, sessionId: session.id }
}

export type ReturnOutcome = 'paid' | 'pending' | 'not-ours' | 'unknown'

/**
 * What the shopper's return from Stripe actually means.
 *
 * The session id arrives in a query string, so it is attacker-controlled. It is looked
 * up ON THIS SITE'S connected account — a session from any other account is simply not
 * found there — and its metadata must name this site as well. Only then is its payment
 * status believed.
 *
 * This decides what the shopper is shown and whether their cart is emptied. It does not
 * fulfil anything: orders are created from the webhook (M-07), because a shopper who
 * closes the tab after paying never makes this request at all.
 */
export async function verifyCheckoutReturn(
  db: PrismaTx,
  siteId: string,
  sessionId: string,
): Promise<ReturnOutcome> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return 'unknown'

  const settings = await db.store_settings.findUnique({
    where: { site_id: siteId },
    select: { stripe_account_id: true },
  })
  if (!settings?.stripe_account_id) return 'unknown'

  let session: Stripe.Checkout.Session
  try {
    session = await checkoutStripe().checkout.sessions.retrieve(sessionId, {
      stripeAccount: settings.stripe_account_id,
    })
  } catch {
    // Not on this account, or Stripe is unreachable. Either way we cannot say it paid.
    return 'unknown'
  }

  if (session.metadata?.site_id !== siteId) return 'not-ours'
  // 'paid' covers card and Afterpay once authorised. Anything else — an Afterpay
  // decision still in progress, an abandoned attempt — is not a completed order yet.
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
    ? 'paid'
    : 'pending'
}
