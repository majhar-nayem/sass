import Stripe from 'stripe'

/**
 * M-06 -- the renderer's Stripe client, and why it is not the dashboard's.
 *
 * Checkout starts on a customer's website, so the renderer has to talk to Stripe. But
 * F-06 deliberately gave the renderer no Stripe key: it serves public websites, and a
 * key it holds is a key that can leak from it. A full secret key there would undo that
 * decision for the most exposed process in the system.
 *
 * So this client takes its own key, STRIPE_CHECKOUT_KEY, and that key is meant to be a
 * RESTRICTED key (rk_...) — Stripe recommends one per service — scoped to
 * Checkout Sessions: Write, with the matching permission for connected accounts, and
 * nothing else. If it leaks, the damage is "can create checkout pages", not "can
 * refund, read customers, and change payout destinations".
 *
 * In production an unrestricted sk_ key here is refused rather than tolerated, because
 * it would work perfectly and nobody would ever notice the protection had gone.
 */
let client: Stripe | null = null

export type CheckoutKeyProblem = 'missing' | 'unrestricted-in-production'

export function checkoutKeyProblem(env: NodeJS.ProcessEnv = process.env): CheckoutKeyProblem | null {
  const key = env.STRIPE_CHECKOUT_KEY
  if (!key) return 'missing'
  if (env.NODE_ENV === 'production' && key.startsWith('sk_')) return 'unrestricted-in-production'
  return null
}

export function checkoutConfigured(): boolean {
  return checkoutKeyProblem() === null
}

export function checkoutStripe(): Stripe {
  if (client) return client
  const problem = checkoutKeyProblem()
  if (problem === 'missing') throw new Error('STRIPE_CHECKOUT_KEY is not set.')
  if (problem === 'unrestricted-in-production')
    throw new Error(
      'STRIPE_CHECKOUT_KEY is an unrestricted secret key. The renderer serves public websites and ' +
        'must hold a restricted key (rk_...) limited to Checkout Sessions.',
    )
  client = new Stripe(process.env.STRIPE_CHECKOUT_KEY!, {
    apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
    ...apiOverride(),
  })
  return client
}

/**
 * Points the client at a local stand-in for Stripe, so an end-to-end run can inspect
 * the exact request that would have gone out — the Stripe-Account header above all.
 * Ignored in production: a misplaced environment variable must never be able to send
 * real card traffic somewhere else.
 */
function apiOverride(): { host?: string; port?: number; protocol?: 'http' | 'https' } {
  if (process.env.NODE_ENV === 'production' || !process.env.STRIPE_API_HOST) return {}
  return {
    host: process.env.STRIPE_API_HOST,
    port: Number(process.env.STRIPE_API_PORT ?? 443),
    protocol: process.env.STRIPE_API_PROTOCOL === 'http' ? 'http' : 'https',
  }
}

export function __setCheckoutStripe(s: Stripe | null): void {
  client = s
}
