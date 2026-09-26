import { handleStripeEvent } from '@awning/api'
import { parseWebhook } from '@awning/integrations/stripe'
import { logger, reportError } from '@awning/integrations/observability'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * M-01 -- the Stripe webhook.
 *
 * The raw body is required: the signature is computed over the exact bytes Stripe sent,
 * so anything that reparses and re-serialises the JSON first invalidates it.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return new Response('Billing is not configured.', { status: 503 })

  const raw = await req.text()
  let event
  try {
    event = parseWebhook(raw, req.headers.get('stripe-signature'), secret)
  } catch (e) {
    // 400, not 500: a bad signature is a rejected request, and returning 500 would make
    // Stripe retry something that can never succeed.
    logger.warn('stripe.webhook.rejected', { message: (e as Error).message })
    return new Response('Invalid signature.', { status: 400 })
  }

  try {
    const outcome = await handleStripeEvent(event)
    return Response.json(outcome)
  } catch (e) {
    // A 500 asks Stripe to retry, which is what we want for a transient database
    // failure. The idempotency record means the retry is safe.
    reportError(e, { stripe_event: event.type })
    return new Response('Handler failed.', { status: 500 })
  }
}
