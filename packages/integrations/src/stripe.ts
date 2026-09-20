import Stripe from 'stripe'

/**
 * M-01 -- Stripe Billing.
 *
 * Subscriptions only. Tenant commerce runs through Connect Standard and settles into the
 * tenant's own account, so no customer's money ever touches a platform balance — that is
 * the line between being a software vendor and being a payment facilitator, with the
 * AUSTRAC and ASIC exposure that carries (docs/06-COMMERCE-BILLING.md §3).
 */
let client: Stripe | null = null

export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set.')
    client = new Stripe(key, { apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion })
  }
  return client
}

export function __setStripe(s: Stripe | null): void {
  client = s
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

/** plan_code -> Stripe price id. Kept in env so prices can change without a deploy. */
export function priceIdFor(planCode: string): string | null {
  return process.env[`STRIPE_PRICE_${planCode.toUpperCase()}`] ?? null
}

export interface CheckoutInput {
  orgId: string
  planCode: string
  customerId?: string | null
  email: string
  successUrl: string
  cancelUrl: string
}

export async function createCheckoutSession(input: CheckoutInput): Promise<{ url: string; sessionId: string }> {
  const price = priceIdFor(input.planCode)
  if (!price) throw new Error(`No Stripe price configured for plan "${input.planCode}".`)

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // The org id must survive the round trip: the webhook is the only place the
    // subscription becomes real, and it arrives with no session context of its own.
    client_reference_id: input.orgId,
    subscription_data: { metadata: { org_id: input.orgId, plan_code: input.planCode } },
    metadata: { org_id: input.orgId, plan_code: input.planCode },
    // Australian GST. Prices are stored and displayed GST-inclusive, so what an owner
    // is quoted is what leaves their account (ACL component pricing).
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
  })

  if (!session.url) throw new Error('Stripe returned a session with no URL.')
  return { url: session.url, sessionId: session.id }
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
  return session.url
}

/**
 * Verifies the signature and returns the event.
 *
 * Signature verification is what separates "Stripe told us this" from "someone posted
 * JSON at our webhook". An unsigned webhook that activates subscriptions is a free
 * subscription for anyone who reads the URL out of a network tab.
 */
export function parseWebhook(rawBody: string, signature: string | null, secret: string): Stripe.Event {
  if (!signature) throw new Error('Missing Stripe signature.')
  return stripe().webhooks.constructEvent(rawBody, signature, secret)
}

/** The events we act on. Anything else is recorded and ignored. */
export const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
])

/** Stripe's status vocabulary is wider than ours; everything unknown is treated as inactive. */
export function mapSubscriptionStatus(s: string): 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'paused' {
  switch (s) {
    case 'trialing':
      return 'trialing'
    case 'active':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'paused':
      return 'paused'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    default:
      return 'incomplete'
  }
}

/** Publishing is the paywall: a trial can build and preview, not go live. */
export function canPublish(status: string): boolean {
  // past_due deliberately still publishes. Taking a tradie's website offline because
  // their card expired is how you lose a customer and get talked about — dunning is
  // seven days of email first (docs/06-COMMERCE-BILLING.md §2).
  return status === 'active' || status === 'past_due'
}
