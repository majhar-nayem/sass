import { handleConnectEvent } from '@awning/api'
import { parseWebhook } from '@awning/integrations/stripe'
import { withoutOrgContext } from '@awning/db'
import { logger, reportError, requestIdFrom, runWithRequestContext } from '@awning/integrations/observability'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * M-03 -- Connect account events.
 *
 * A separate endpoint with its own signing secret. These arrive from a different
 * Stripe configuration to the billing events, and sharing a secret would mean one
 * leak forges both.
 *
 * Runs without org context: the event names a Stripe account, and which tenant that
 * belongs to is exactly what the handler has to look up.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) return new Response('Connect is not configured.', { status: 503 })

  const raw = await req.text()
  let event
  try {
    event = parseWebhook(raw, req.headers.get('stripe-signature'), secret)
  } catch (e) {
    // 400, not 500: a bad signature can never succeed on retry.
    logger.warn('stripe.connect.rejected', { message: (e as Error).message })
    return new Response('Invalid signature.', { status: 400 })
  }

  return runWithRequestContext(
    { requestId: requestIdFrom(req.headers), service: 'app', route: '/api/webhooks/stripe/connect' },
    async () => {
      try {
        const outcome = await withoutOrgContext('webhook', (db) => handleConnectEvent(db, event))
        return Response.json({ outcome })
      } catch (e) {
        // 500 asks Stripe to retry, which is right for a transient database failure —
        // and the handler only ever writes a state it recomputes from the event.
        reportError(e, { stripe_event: event.type })
        return new Response('Handler failed.', { status: 500 })
      }
    },
  )
}
