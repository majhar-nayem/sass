import type Stripe from 'stripe'
import { withoutOrgContext } from '@awning/db'
import { mapSubscriptionStatus } from '@awning/integrations/stripe'
import { restoreAfterPayment } from './dunning.js'

/**
 * M-01 -- Stripe webhook handling.
 *
 * Stripe guarantees at-least-once delivery, so duplicates are normal traffic rather than
 * an edge case: a retried `checkout.session.completed` that creates a second
 * subscription, or a duplicated order that decrements stock twice, is the kind of bug
 * that costs a customer. Every event is recorded by its own id first and skipped if it
 * has been seen.
 */
export type WebhookOutcome =
  | { handled: true; action: string }
  | { handled: false; reason: 'duplicate' | 'ignored' | 'unknown-org' }

export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  return withoutOrgContext('webhook', async (db) => {
    // Claim the event id. The unique primary key is what makes this safe under
    // concurrent delivery, not the read-then-write that would look equivalent.
    try {
      await db.webhook_events.create({
        data: {
          id: event.id,
          provider: 'stripe',
          type: event.type,
          payload: event as unknown as object,
        },
      })
    } catch {
      return { handled: false, reason: 'duplicate' as const }
    }

    let action = 'ignored'
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const s = event.data.object as Stripe.Checkout.Session
          const orgId = s.client_reference_id ?? (s.metadata?.org_id as string | undefined)
          if (!orgId) return finish(db, event.id, { handled: false, reason: 'unknown-org' as const })

          const planCode = (s.metadata?.plan_code as string | undefined) ?? 'founding'
          await db.organizations.update({
            where: { id: orgId },
            data: {
              stripe_customer_id: typeof s.customer === 'string' ? s.customer : null,
              ...(s.customer_details?.email ? { billing_email: s.customer_details.email } : {}),
            },
          })
          await db.subscriptions.update({
            where: { org_id: orgId },
            data: {
              plan_code: planCode,
              status: 'active',
              stripe_subscription_id: typeof s.subscription === 'string' ? s.subscription : null,
              // Founding pricing is locked for 12 months, which is both the urgency
              // lever and a churn brake: leaving means losing the rate.
              ...(planCode === 'founding' ? { price_locked_cents: 3900 } : {}),
            },
          })
          action = 'subscription-activated'
          break
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription
          const orgId = sub.metadata?.org_id as string | undefined
          const where = orgId ? { org_id: orgId } : { stripe_subscription_id: sub.id }
          const existing = await db.subscriptions.findFirst({ where, select: { org_id: true } })
          if (!existing) return finish(db, event.id, { handled: false, reason: 'unknown-org' as const })

          await db.subscriptions.update({
            where: { org_id: existing.org_id },
            data: {
              status: mapSubscriptionStatus(sub.status),
              stripe_subscription_id: sub.id,
              cancel_at_period_end: sub.cancel_at_period_end ?? false,
              ...(sub.current_period_start
                ? { current_period_start: new Date(sub.current_period_start * 1000) }
                : {}),
              ...(sub.current_period_end
                ? { current_period_end: new Date(sub.current_period_end * 1000) }
                : {}),
            },
          })
          action = `subscription-${mapSubscriptionStatus(sub.status)}`
          break
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription
          const existing = await db.subscriptions.findFirst({
            where: { stripe_subscription_id: sub.id },
            select: { org_id: true },
          })
          if (!existing) return finish(db, event.id, { handled: false, reason: 'unknown-org' as const })

          await db.subscriptions.update({
            where: { org_id: existing.org_id },
            data: { status: 'canceled', canceled_at: new Date() },
          })
          // The site stays up. A seven-day grace window is the difference between a
          // customer who resubscribes and one who finds their business offline.
          action = 'subscription-canceled'
          break
        }

        case 'invoice.payment_succeeded': {
          const inv = event.data.object as Stripe.Invoice
          const subId = typeof inv.subscription === 'string' ? inv.subscription : null
          if (!subId) break
          const existing = await db.subscriptions.findFirst({
            where: { stripe_subscription_id: subId },
            select: { org_id: true },
          })
          if (!existing) break
          await db.subscriptions.update({
            where: { org_id: existing.org_id },
            data: { status: 'active' },
          })
          // Paying brings a suspended site straight back and clears the reminder
          // history, so a second lapse starts the schedule from the beginning.
          const restored = await restoreAfterPayment(db, existing.org_id)
          action = restored > 0 ? 'payment-succeeded-restored' : 'payment-succeeded'
          break
        }

        case 'invoice.payment_failed': {
          const inv = event.data.object as Stripe.Invoice
          const subId = typeof inv.subscription === 'string' ? inv.subscription : null
          if (!subId) break
          const existing = await db.subscriptions.findFirst({
            where: { stripe_subscription_id: subId },
            select: { org_id: true },
          })
          if (!existing) break
          // past_due, NOT suspended. Expired cards are the biggest cause of
          // involuntary churn at this price point, and a tradie whose site vanishes
          // because of one does not come back.
          await db.subscriptions.update({
            where: { org_id: existing.org_id },
            data: { status: 'past_due' },
          })
          action = 'payment-failed'
          break
        }

        default:
          action = 'ignored'
      }
    } catch (e) {
      await db.webhook_events.update({
        where: { id: event.id },
        data: { error: (e as Error).message, attempts: { increment: 1 } },
      })
      throw e
    }

    return finish(db, event.id, { handled: action !== 'ignored', action } as WebhookOutcome)
  })
}

async function finish<T extends WebhookOutcome>(
  db: Parameters<Parameters<typeof withoutOrgContext>[1]>[0],
  id: string,
  outcome: T,
): Promise<T> {
  await db.webhook_events.update({ where: { id }, data: { processed_at: new Date() } })
  return outcome
}
