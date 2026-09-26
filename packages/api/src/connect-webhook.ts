import type Stripe from 'stripe'
import type { PrismaTx } from '@awning/db'
import { fromAccount } from '@awning/integrations/stripe-connect'
import { logger } from '@awning/integrations/observability'
import { applyAccountStatus } from './store.js'

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
