import type Stripe from 'stripe'
import { stripe, stripeConfigured } from './stripe.js'

/**
 * M-03 -- Stripe Connect Standard.
 *
 * The tenant connects their own Stripe account and money settles directly to their
 * bank. It never touches a balance we control, which is the whole reason this is
 * Standard and not platform-collect: holding a butcher's Christmas takings would make
 * us a payment facilitator, with the AUSTRAC and licensing weight that implies
 * (docs/06-COMMERCE-BILLING.md §3).
 *
 * The practical consequence for this file: we can create an account and send someone
 * to Stripe to fill it in, but only Stripe can tell us whether that worked.
 */

export interface ConnectedAccountStatus {
  accountId: string
  /** The only field that decides whether a shop can take money. */
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  /** What Stripe is still waiting on, if anything. Shown to the owner verbatim. */
  currentlyDue: string[]
  /** Set when Stripe has stopped the account; the owner has to resolve it with Stripe. */
  disabledReason: string | null
}

export { stripeConfigured }

/**
 * Creates the tenant's account.
 *
 * `email` and `business_profile` are a courtesy — they prefill Stripe's form. Nothing
 * here is authoritative: the tenant can change any of it during onboarding, and the
 * values Stripe ends up with are the ones that matter.
 */
export async function createConnectedAccount(input: {
  email?: string | null
  businessName: string
  siteUrl?: string | null
}): Promise<string> {
  const account = await stripe().accounts.create({
    type: 'standard',
    country: 'AU',
    ...(input.email ? { email: input.email } : {}),
    business_profile: {
      name: input.businessName,
      ...(input.siteUrl ? { url: input.siteUrl } : {}),
    },
    metadata: { platform: 'awning' },
  })
  return account.id
}

/**
 * A one-time URL that takes the owner into Stripe's onboarding.
 *
 * Account links expire in minutes and are single-use, so this is generated per click
 * and never stored. `refreshUrl` is where Stripe sends them if the link has gone
 * stale — it must start the flow again rather than show an error.
 */
export async function createAccountLink(
  accountId: string,
  urls: { refreshUrl: string; returnUrl: string },
): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: 'account_onboarding',
  })
  return link.url
}

/**
 * Asks Stripe what is actually true.
 *
 * This is the point of the whole module. Stripe's `return_url` is a plain redirect
 * with no signature and no guarantee: an owner can reach it by pressing back, by
 * abandoning the form, or by pasting it — and a shop that believes it can take
 * payments when it cannot produces a customer at a checkout that fails.
 */
export async function getAccountStatus(accountId: string): Promise<ConnectedAccountStatus> {
  return fromAccount(await stripe().accounts.retrieve(accountId))
}

export function fromAccount(account: Stripe.Account): ConnectedAccountStatus {
  return {
    accountId: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    currentlyDue: account.requirements?.currently_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  }
}

/**
 * Standard accounts have their own Stripe dashboard and their own login.
 *
 * Deliberately not `accounts.createLoginLink`, which is for Express: on Standard it
 * fails, and the tenant owns this account outright — including when they stop being
 * our customer.
 */
export const STRIPE_DASHBOARD_URL = 'https://dashboard.stripe.com/'
