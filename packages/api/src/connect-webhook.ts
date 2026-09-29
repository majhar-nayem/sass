import type Stripe from 'stripe'
import { withoutOrgContext, type PrismaTx } from '@awning/db'
import { fromAccount } from '@awning/integrations/stripe-connect'
import { logger } from '@awning/integrations/observability'
import { applyAccountStatus } from './store.js'
import { processOnce } from './webhook-once.js'
import { recordOrder, snapshotSession, type OrderOutcome } from './orders.js'
import { notifyOrder } from './order-mail.js'

/**
 * M-03 -- events about the tenants' own accounts.
 *
 * A separate endpoint and a separate signing secret from the billing webhook, because
 * these arrive from a different Stripe configuration and mixing them means one leaked
 * secret forges both.
 *
 * Why it exists at all: onboarding is not the only time `charges_enabled` changes.
 * Stripe re-verifies businesses, asks for documents months later, and restricts
 * accounts. Without this, a shop keeps advertising checkout long after Stripe stopped
 * allowing it, and the first sign is a customer who cannot pay.
 */
export const CONNECT_EVENTS = new Set(['account.updated', 'account.application.deauthorized'])

export type ConnectOutcome = 'applied' | 'ignored' | 'unknown_account'

export async function handleConnectEvent(db: PrismaTx, event: Stripe.Event): Promise<ConnectOutcome> {
  if (!CONNECT_EVENTS.has(event.type)) return 'ignored'

  // For Connect events the account id is on the envelope, not only in the payload.
  const accountId =
    event.account ?? (event.data.object as { id?: string } | undefined)?.id ?? null
  if (!accountId) return 'ignored'

  const settings = await db.store_settings.findFirst({
    where: { stripe_account_id: accountId },
    select: { site_id: true, stripe_account_id: true, stripe_onboarded_at: true },
  })
  // An account we have no record of. Normal if a tenant disconnected, and never an
  // error worth paging anyone about.
  if (!settings) return 'unknown_account'

  if (event.type === 'account.application.deauthorized') {
    // They revoked our access from their own Stripe dashboard. Their decision; the
    // shop stops claiming it can take payments immediately.
    await db.store_settings.update({
      where: { site_id: settings.site_id },
      data: { stripe_account_id: null, stripe_onboarded_at: null },
    })
    logger.warn('store.stripe.deauthorized', { site_id: settings.site_id })
    return 'applied'
  }

  await applyAccountStatus(db, settings.site_id, settings, fromAccount(event.data.object as Stripe.Account))
  return 'applied'
}

// ---------------------------------------------------------------------------- orders

/** Where each Checkout event says a session has got to. */
const ORDER_EVENTS: Record<string, 'from-session' | 'paid' | 'cancelled'> = {
  'checkout.session.completed': 'from-session',
  // Asynchronous methods settle later; Stripe's documented Checkout fulfilment pattern.
  'checkout.session.async_payment_succeeded': 'paid',
  'checkout.session.async_payment_failed': 'cancelled',
}

export type ReceiveOutcome =
  | { kind: 'duplicate' }
  | { kind: 'account'; outcome: ConnectOutcome }
  | { kind: 'order'; outcome: OrderOutcome; notified?: { owner: boolean; customer: boolean } }
  | { kind: 'ignored'; reason: string }

/**
 * The route's entry point: every Connect event, exactly once.
 *
 * For an order the sequence matters. Line items are fetched from Stripe first, outside
 * any transaction. Then the claim and the order commit together. Then — only then — the
 * emails go out, so a mail failure can never undo a paid order.
 */
export async function receiveConnectEvent(event: Stripe.Event): Promise<ReceiveOutcome> {
  const stage = ORDER_EVENTS[event.type]

  if (!stage) {
    if (!CONNECT_EVENTS.has(event.type)) return { kind: 'ignored', reason: 'unhandled-type' }
    const r = await processOnce(asRecord(event), 'stripe-connect', (db) => handleConnectEvent(db, event))
    return r.duplicate ? { kind: 'duplicate' } : { kind: 'account', outcome: r.result }
  }

  const session = event.data.object as Stripe.Checkout.Session
  const accountId = event.account ?? null
  // Cheap rejections before any network call.
  if (!accountId) return { kind: 'ignored', reason: 'no-account' }
  if (session.metadata?.platform !== 'awning') return { kind: 'ignored', reason: 'not-ours' }

  const settings = await withoutOrgContext('webhook', (db) =>
    db.store_settings.findFirst({ where: { stripe_account_id: accountId }, select: { site_id: true } }),
  )
  if (!settings) return { kind: 'ignored', reason: 'unknown-account' }
  const siteId = settings.site_id

  // A retry of something already applied: skip the Stripe call, but finish any email
  // that never went out — a process that died between committing the order and sending
  // would otherwise leave the owner permanently untold.
  const seen = await withoutOrgContext('webhook', (db) =>
    db.webhook_events.findUnique({ where: { id: event.id }, select: { processed_at: true } }),
  )
  if (seen?.processed_at) {
    await retryNotification(session.id)
    return { kind: 'duplicate' }
  }

  const snap = await snapshotSession(accountId, session)
  const want =
    stage === 'from-session'
      ? session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
        ? 'paid'
        : 'pending'
      : stage

  const r = await processOnce(asRecord(event), 'stripe-connect', (db) => recordOrder(db, siteId, snap, want))
  if (r.duplicate) {
    await retryNotification(session.id)
    return { kind: 'duplicate' }
  }

  const o = r.result
  if (o.kind === 'created-paid' || o.kind === 'marked-paid') {
    const notified = await withoutOrgContext('webhook', (db) => notifyOrder(db, o.orderId, o.oversold))
    return { kind: 'order', outcome: o, notified }
  }
  return { kind: 'order', outcome: o }
}

const asRecord = (event: Stripe.Event) => ({ id: event.id, type: event.type, payload: event })

async function retryNotification(sessionId: string): Promise<void> {
  await withoutOrgContext('webhook', async (db) => {
    const order = await db.orders.findUnique({
      where: { stripe_checkout_session_id: sessionId },
      select: { id: true, status: true },
    })
    if (order?.status === 'paid') await notifyOrder(db, order.id)
  })
}
