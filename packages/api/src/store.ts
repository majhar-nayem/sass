import { TRPCError } from '@trpc/server'
import type { PrismaTx } from '@awning/db'
import {
  createAccountLink,
  createConnectedAccount,
  fromAccount,
  getAccountStatus,
  stripeConfigured,
  type ConnectedAccountStatus,
} from '@awning/integrations/stripe-connect'
import { logger } from '@awning/integrations/observability'
import { loadFulfilment, parsePostcodeList } from '@awning/commerce'

/**
 * M-03 -- connecting a tenant's Stripe account.
 *
 * Two hazards shape everything here.
 *
 * The first is orphaning. `accounts.create` is not idempotent and the account it makes
 * is permanent — a second call leaves a real Stripe account nobody owns, attached to a
 * business that thinks it connected once. So the id is written to our database before
 * the owner is sent anywhere, and never created twice.
 *
 * The second is trust. Stripe's `return_url` is an unsigned redirect that an owner can
 * reach by pressing back or abandoning the form halfway. Treating it as proof of
 * onboarding produces a shop that believes it can take money and a customer at a
 * checkout that fails. Only `charges_enabled`, read from Stripe, sets that flag.
 */

export type PaymentsState =
  | 'unconfigured' // no Stripe keys on the platform at all
  | 'not_connected' // the tenant has not started
  | 'incomplete' // started, Stripe still wants something
  | 'restricted' // Stripe has disabled the account
  | 'ready' // charges_enabled

export interface StorePayments {
  state: PaymentsState
  accountId: string | null
  onboardedAt: Date | null
  /** What Stripe is waiting for, in Stripe's own words. */
  currentlyDue: string[]
  disabledReason: string | null
  /** The one question the rest of the product asks. */
  canAcceptPayments: boolean
}

/** Settings row, created on first read. A site without a shop simply never asks. */
export async function ensureStoreSettings(db: PrismaTx, siteId: string) {
  const existing = await db.store_settings.findUnique({ where: { site_id: siteId } })
  if (existing) return existing
  return db.store_settings.create({ data: { site_id: siteId } })
}

export function paymentsFrom(
  row: { stripe_account_id: string | null; stripe_onboarded_at: Date | null },
  live?: ConnectedAccountStatus | null,
): StorePayments {
  if (!stripeConfigured())
    return {
      state: 'unconfigured',
      accountId: row.stripe_account_id,
      onboardedAt: row.stripe_onboarded_at,
      currentlyDue: [],
      disabledReason: null,
      canAcceptPayments: false,
    }

  if (!row.stripe_account_id)
    return {
      state: 'not_connected',
      accountId: null,
      onboardedAt: null,
      currentlyDue: [],
      disabledReason: null,
      canAcceptPayments: false,
    }

  // Without a live reading we fall back to what we last recorded. `stripe_onboarded_at`
  // is only ever written when Stripe said charges were enabled, so it is safe to trust
  // in that direction — but it can go stale if Stripe later restricts the account,
  // which is why the webhook exists.
  if (!live)
    return {
      state: row.stripe_onboarded_at ? 'ready' : 'incomplete',
      accountId: row.stripe_account_id,
      onboardedAt: row.stripe_onboarded_at,
      currentlyDue: [],
      disabledReason: null,
      canAcceptPayments: !!row.stripe_onboarded_at,
    }

  const state: PaymentsState = live.chargesEnabled
    ? 'ready'
    : live.disabledReason
      ? 'restricted'
      : 'incomplete'

  return {
    state,
    accountId: live.accountId,
    onboardedAt: row.stripe_onboarded_at,
    currentlyDue: live.currentlyDue,
    disabledReason: live.disabledReason,
    canAcceptPayments: live.chargesEnabled,
  }
}

/**
 * Starts or resumes onboarding, returning a URL to send the owner to.
 *
 * Resuming matters more than starting: most owners do not finish in one sitting —
 * Stripe asks for an ABN, a bank account and photo ID — and the second visit must
 * continue the same account rather than begin a new one.
 */
export async function startStripeOnboarding(
  db: PrismaTx,
  siteId: string,
  urls: { refreshUrl: string; returnUrl: string },
): Promise<{ url: string; accountId: string }> {
  if (!stripeConfigured())
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Online payments are not set up on this platform yet.',
    })

  const site = await db.sites.findUnique({
    where: { id: siteId },
    select: { id: true, name: true, organizations: { select: { billing_email: true } } },
  })
  if (!site) throw new TRPCError({ code: 'NOT_FOUND' })

  const settings = await ensureStoreSettings(db, siteId)

  let accountId = settings.stripe_account_id
  if (!accountId) {
    accountId = await createConnectedAccount({
      businessName: site.name,
      email: site.organizations.billing_email,
    })
    // Written before the owner goes anywhere. A crash here must leave a recoverable
    // account attached to this site, not a live Stripe account nobody can find.
    await db.store_settings.update({
      where: { site_id: siteId },
      data: { stripe_account_id: accountId },
    })
    logger.info('store.stripe.account_created', { site_id: siteId })
  }

  return { url: await createAccountLink(accountId, urls), accountId }
}

/**
 * Re-reads the account from Stripe and records the answer.
 *
 * Called when the owner comes back from onboarding and from the Connect webhook. It
 * is the only writer of `stripe_onboarded_at`, and it writes it only on
 * `charges_enabled` — `details_submitted` means the form was filled in, which is not
 * the same as being able to take a payment.
 */
export async function syncStripeAccount(db: PrismaTx, siteId: string): Promise<StorePayments> {
  const settings = await ensureStoreSettings(db, siteId)
  if (!settings.stripe_account_id) return paymentsFrom(settings)

  let live: ConnectedAccountStatus
  try {
    live = await getAccountStatus(settings.stripe_account_id)
  } catch (e) {
    // Stripe being unreachable must not flip a working shop to "not connected".
    logger.warn('store.stripe.sync_failed', { site_id: siteId, message: (e as Error).message })
    return paymentsFrom(settings)
  }

  return applyAccountStatus(db, siteId, settings, live)
}

/** Shared by the sync path and the webhook, so both reach the same conclusion. */
export async function applyAccountStatus(
  db: PrismaTx,
  siteId: string,
  settings: { stripe_account_id: string | null; stripe_onboarded_at: Date | null },
  live: ConnectedAccountStatus,
): Promise<StorePayments> {
  const shouldBeOnboarded = live.chargesEnabled
  const isOnboarded = !!settings.stripe_onboarded_at

  if (shouldBeOnboarded !== isOnboarded) {
    await db.store_settings.update({
      where: { site_id: siteId },
      // Cleared when Stripe withdraws the ability to charge, so the shop stops
      // claiming it can take money the moment that becomes untrue.
      data: { stripe_onboarded_at: shouldBeOnboarded ? new Date() : null },
    })
    logger.info('store.stripe.status_changed', {
      site_id: siteId,
      charges_enabled: shouldBeOnboarded,
      disabled_reason: live.disabledReason,
    })
  }

  return paymentsFrom(
    { ...settings, stripe_onboarded_at: shouldBeOnboarded ? (settings.stripe_onboarded_at ?? new Date()) : null },
    live,
  )
}

/**
 * Forgets the connection from our side.
 *
 * Deliberately does not delete the Stripe account: it belongs to the tenant, it holds
 * their payout history and their customers' receipts, and deleting it because someone
 * clicked "disconnect" in our dashboard would be destroying records that are not ours.
 */
export async function disconnectStripe(db: PrismaTx, siteId: string): Promise<void> {
  await db.store_settings.update({
    where: { site_id: siteId },
    data: { stripe_account_id: null, stripe_onboarded_at: null },
  })
  logger.info('store.stripe.disconnected', { site_id: siteId })
}

export { fromAccount }

// ------------------------------------------------------------------ fulfilment (M-09)


export interface FulfilmentForm {
  pickup: { enabled: boolean; address: string; instructions: string }
  delivery: { enabled: boolean; postcodes: string; feeCents: number; minCents: number | null }
  post: { enabled: boolean; name: string; priceCents: number; freeOverCents: number | null }
}

/**
 * The fulfilment screen, pre-filled so the common case is one tick and a save.
 *
 * The acceptance criterion is a butcher setting up pickup-only in under two minutes. So
 * the pickup address starts from the business address we already hold, and delivery and
 * post start off. Nothing is switched ON for them: offering pickup is a commitment to
 * have someone at the counter, and that is theirs to make.
 */
export async function fulfilmentForm(db: PrismaTx, siteId: string): Promise<FulfilmentForm> {
  const [f, site, rate] = await Promise.all([
    loadFulfilment(db, siteId),
    db.sites.findUnique({ where: { id: siteId }, select: { business_address: true } }),
    db.shipping_rates.findFirst({ where: { site_id: siteId, method: 'shipping' }, orderBy: { position: 'asc' } }),
  ])
  const a = site?.business_address as { suburb?: string; state?: string; postcode?: string } | null
  const suggested = [a?.suburb, a?.state, a?.postcode].filter(Boolean).join(' ')
  return {
    pickup: { enabled: f.pickup.enabled, address: f.pickup.address ?? suggested, instructions: f.pickup.instructions ?? '' },
    delivery: {
      enabled: f.delivery.enabled,
      postcodes: f.delivery.postcodes.join(', '),
      feeCents: f.delivery.feeCents,
      minCents: f.delivery.minCents,
    },
    post: {
      enabled: !!rate?.is_active,
      name: rate?.name ?? 'Standard post',
      priceCents: rate?.price_cents ?? 1200,
      freeOverCents: rate?.free_over_cents ?? null,
    },
  }
}

export type SaveProblem = { field: string; message: string }

/**
 * Saves the screen in one go, or not at all.
 *
 * Refuses a half-configured shop rather than saving it: "pickup on" with no address,
 * or "delivery on" with no postcodes, is an option the customer can pick and nobody can
 * fulfil.
 */
export async function saveFulfilment(
  db: PrismaTx,
  siteId: string,
  form: FulfilmentForm,
): Promise<{ ok: true } | { ok: false; problems: SaveProblem[] }> {
  const problems: SaveProblem[] = []
  const address = form.pickup.address.trim()
  if (form.pickup.enabled && address.length < 5)
    problems.push({ field: 'pickup.address', message: 'Add the address customers come to.' })

  const parsed = parsePostcodeList(form.delivery.postcodes)
  if (form.delivery.enabled) {
    if (parsed.rejected.length)
      problems.push({ field: 'delivery.postcodes', message: `We could not read: ${parsed.rejected.join(', ')}. Use four-digit postcodes, or a range like 5106-5110.` })
    else if (parsed.postcodes.length === 0)
      problems.push({ field: 'delivery.postcodes', message: 'List the postcodes you deliver to.' })
  }
  if (form.post.enabled && !form.post.name.trim())
    problems.push({ field: 'post.name', message: 'Give the postage option a name.' })

  if (!form.pickup.enabled && !form.delivery.enabled && !form.post.enabled)
    problems.push({ field: 'all', message: 'Turn on at least one way for customers to get their order.' })

  if (problems.length) return { ok: false, problems }

  await ensureStoreSettings(db, siteId)
  await db.store_settings.update({
    where: { site_id: siteId },
    data: {
      pickup_enabled: form.pickup.enabled,
      pickup_address: address ? { text: address.slice(0, 300) } : undefined,
      pickup_instructions: form.pickup.instructions.trim().slice(0, 300) || null,
      local_delivery_enabled: form.delivery.enabled,
      local_delivery_postcodes: parsed.postcodes,
      local_delivery_fee_cents: Math.max(0, Math.round(form.delivery.feeCents)),
      local_delivery_min_cents: form.delivery.minCents && form.delivery.minCents > 0 ? Math.round(form.delivery.minCents) : null,
    },
  })

  // One postage option from this screen. More is later; one covers the market.
  const existing = await db.shipping_rates.findFirst({ where: { site_id: siteId, method: 'shipping' }, orderBy: { position: 'asc' } })
  const rate = {
    name: form.post.name.trim().slice(0, 80) || 'Standard post',
    price_cents: Math.max(0, Math.round(form.post.priceCents)),
    free_over_cents: form.post.freeOverCents && form.post.freeOverCents > 0 ? Math.round(form.post.freeOverCents) : null,
    is_active: form.post.enabled,
  }
  if (existing) await db.shipping_rates.update({ where: { id: existing.id }, data: rate })
  else if (form.post.enabled) await db.shipping_rates.create({ data: { site_id: siteId, method: 'shipping', ...rate } })

  return { ok: true }
}
