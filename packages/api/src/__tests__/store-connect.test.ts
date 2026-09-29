import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rawPrisma } from '@awning/db'
import { __setStripe } from '@awning/integrations/stripe'
import {
  applyAccountStatus,
  disconnectStripe,
  ensureStoreSettings,
  startStripeOnboarding,
  syncStripeAccount,
} from '../store.js'
import { handleConnectEvent } from '../connect-webhook.js'

/**
 * M-03 -- connecting a tenant's own Stripe account.
 *
 * The money settles to the tenant and never touches a balance we control, so almost
 * everything here is about not lying to ourselves about whether that connection works.
 */
const orgId = randomUUID()
const siteId = randomUUID()
// Unique per run: Stripe account ids are globally unique, and the webhook resolves a
// tenant by this value. A fixture that reuses one across runs makes the lookup
// ambiguous — which is how the missing unique index turned up.
const ACCT = `acct_${siteId.replace(/-/g, '').slice(0, 16)}`

const account = (over: Partial<Stripe.Account> = {}): Stripe.Account =>
  ({
    id: ACCT,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: { currently_due: [], disabled_reason: null },
    ...over,
  }) as Stripe.Account

const created = vi.fn()
const linked = vi.fn()
const retrieved = vi.fn()

function stubStripe() {
  __setStripe({
    accounts: {
      create: created,
      retrieve: retrieved,
    },
    accountLinks: { create: linked },
  } as unknown as Stripe)
}

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_forcing_configured'
  await rawPrisma.organizations.create({
    data: { id: orgId, name: 'Store Test', slug: `store-${orgId.slice(0, 8)}`, state: 'SA', billing_email: 'owner@example.com' },
  })
  await rawPrisma.sites.create({
    data: { id: siteId, org_id: orgId, name: "Dave's Meats", slug: `store-${siteId.slice(0, 8)}`, status: 'draft' },
  })
})

beforeEach(async () => {
  created.mockReset().mockResolvedValue({ id: ACCT })
  linked.mockReset().mockResolvedValue({ url: 'https://connect.stripe.com/setup/s/abc' })
  retrieved.mockReset().mockResolvedValue(account())
  stubStripe()
  await rawPrisma.store_settings.deleteMany({ where: { site_id: siteId } })
})

afterEach(() => __setStripe(null))

const urls = { refreshUrl: 'https://app.test/r', returnUrl: 'https://app.test/x' }

describe('starting onboarding', () => {
  it('creates the account and returns somewhere to send the owner', async () => {
    const out = await startStripeOnboarding(rawPrisma, siteId, urls)
    expect(out.url).toContain('connect.stripe.com')
    expect(created).toHaveBeenCalledOnce()
    expect(created.mock.calls[0]![0]).toMatchObject({ type: 'standard', country: 'AU' })
  })

  /**
   * accounts.create is not idempotent and the account it makes is permanent. Writing
   * the id before the owner goes anywhere is what stops a crash mid-flow from leaving
   * a live Stripe account nobody can find.
   */
  it('stores the account id before handing out the link', async () => {
    linked.mockImplementation(async () => {
      const row = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
      expect(row?.stripe_account_id).toBe(ACCT)
      return { url: 'https://connect.stripe.com/setup/s/abc' }
    })
    await startStripeOnboarding(rawPrisma, siteId, urls)
  })

  // Most owners do not finish in one sitting: Stripe wants an ABN, a bank account and ID.
  it('resumes the same account instead of creating a second one', async () => {
    await startStripeOnboarding(rawPrisma, siteId, urls)
    await startStripeOnboarding(rawPrisma, siteId, urls)
    expect(created).toHaveBeenCalledOnce()
    expect(linked).toHaveBeenCalledTimes(2)
  })

  it('refuses when the platform has no Stripe keys', async () => {
    const key = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    await expect(startStripeOnboarding(rawPrisma, siteId, urls)).rejects.toThrow(/not set up/i)
    process.env.STRIPE_SECRET_KEY = key
  })
})

/**
 * The important one. Stripe's return_url is an unsigned redirect that an owner reaches
 * by finishing, by pressing back, or by abandoning the form halfway.
 */
describe('deciding whether the shop can take money', () => {
  beforeEach(async () => {
    await startStripeOnboarding(rawPrisma, siteId, urls)
  })

  it('does not mark a shop ready just because the owner came back', async () => {
    retrieved.mockResolvedValue(account({ details_submitted: true, charges_enabled: false }))
    const out = await syncStripeAccount(rawPrisma, siteId)
    expect(out.canAcceptPayments).toBe(false)
    expect(out.state).toBe('incomplete')
    const row = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    expect(row?.stripe_onboarded_at).toBeNull()
  })

  it('marks it ready only on charges_enabled', async () => {
    retrieved.mockResolvedValue(account({ details_submitted: true, charges_enabled: true }))
    const out = await syncStripeAccount(rawPrisma, siteId)
    expect(out.state).toBe('ready')
    expect(out.canAcceptPayments).toBe(true)
    const row = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    expect(row?.stripe_onboarded_at).toBeInstanceOf(Date)
  })

  it('tells the owner what Stripe is still waiting for', async () => {
    retrieved.mockResolvedValue(
      account({ requirements: { currently_due: ['individual.id_number'], disabled_reason: null } as unknown as Stripe.Account.Requirements }),
    )
    expect((await syncStripeAccount(rawPrisma, siteId)).currentlyDue).toEqual(['individual.id_number'])
  })

  // Stripe re-verifies businesses months later. A shop that keeps advertising checkout
  // after being restricted produces a customer who cannot pay.
  it('withdraws ready when Stripe restricts the account', async () => {
    retrieved.mockResolvedValue(account({ charges_enabled: true }))
    await syncStripeAccount(rawPrisma, siteId)

    retrieved.mockResolvedValue(
      account({ charges_enabled: false, requirements: { currently_due: [], disabled_reason: 'requirements.past_due' } as unknown as Stripe.Account.Requirements }),
    )
    const out = await syncStripeAccount(rawPrisma, siteId)
    expect(out.state).toBe('restricted')
    expect(out.canAcceptPayments).toBe(false)
    const row = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    expect(row?.stripe_onboarded_at).toBeNull()
  })

  // An outage at Stripe must not present as "you never connected".
  it('keeps the last known answer when Stripe is unreachable', async () => {
    retrieved.mockResolvedValue(account({ charges_enabled: true }))
    await syncStripeAccount(rawPrisma, siteId)

    retrieved.mockRejectedValue(new Error('ECONNRESET'))
    const out = await syncStripeAccount(rawPrisma, siteId)
    expect(out.canAcceptPayments).toBe(true)
    expect(out.state).toBe('ready')
  })
})

describe('disconnecting', () => {
  it('forgets the connection without deleting the tenant’s Stripe account', async () => {
    await startStripeOnboarding(rawPrisma, siteId, urls)
    await disconnectStripe(rawPrisma, siteId)
    const row = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    expect(row?.stripe_account_id).toBeNull()
    // Their payout history and their customers' receipts live in that account. It is
    // not ours to delete because someone clicked a button in our dashboard.
    expect(created.mock.results.length).toBe(1)
  })
})

describe('the Connect webhook', () => {
  const evt = (type: string, obj: unknown, acct = ACCT) =>
    ({ type, account: acct, data: { object: obj } }) as unknown as Stripe.Event

  beforeEach(async () => {
    await startStripeOnboarding(rawPrisma, siteId, urls)
  })

  it('applies a status change that happened outside our flow', async () => {
    const out = await handleConnectEvent(rawPrisma, evt('account.updated', account({ charges_enabled: true })))
    expect(out).toBe('applied')
    const row = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    expect(row?.stripe_onboarded_at).toBeInstanceOf(Date)
  })

  it('clears the connection when the tenant revokes access from their own dashboard', async () => {
    await handleConnectEvent(rawPrisma, evt('account.updated', account({ charges_enabled: true })))
    const out = await handleConnectEvent(rawPrisma, evt('account.application.deauthorized', { id: ACCT }))
    expect(out).toBe('applied')
    const row = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    expect(row?.stripe_account_id).toBeNull()
    expect(row?.stripe_onboarded_at).toBeNull()
  })

  it('ignores an account we hold no record of, without erroring', async () => {
    const out = await handleConnectEvent(rawPrisma, evt('account.updated', account({ id: 'acct_other' }), 'acct_other'))
    expect(out).toBe('unknown_account')
  })

  it('ignores event types it does not handle', async () => {
    expect(await handleConnectEvent(rawPrisma, evt('payout.paid', {}))).toBe('ignored')
  })

  it('is idempotent — a redelivered event changes nothing', async () => {
    const e = evt('account.updated', account({ charges_enabled: true }))
    await handleConnectEvent(rawPrisma, e)
    const first = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    await handleConnectEvent(rawPrisma, e)
    const second = await rawPrisma.store_settings.findUnique({ where: { site_id: siteId } })
    expect(second?.stripe_onboarded_at?.getTime()).toBe(first?.stripe_onboarded_at?.getTime())
  })
})

describe('settings row', () => {
  it('is created on first read and not duplicated', async () => {
    const a = await ensureStoreSettings(rawPrisma, siteId)
    const b = await ensureStoreSettings(rawPrisma, siteId)
    expect(a.site_id).toBe(b.site_id)
    expect(await rawPrisma.store_settings.count({ where: { site_id: siteId } })).toBe(1)
  })

  it('defaults to GST-inclusive AUD, which is the only correct default here', async () => {
    const s = await ensureStoreSettings(rawPrisma, siteId)
    expect(s.currency).toBe('AUD')
    expect(s.prices_include_gst).toBe(true)
  })
})

describe('applyAccountStatus', () => {
  it('reports ready without a second database write when nothing changed', async () => {
    await startStripeOnboarding(rawPrisma, siteId, urls)
    const settings = await ensureStoreSettings(rawPrisma, siteId)
    const out = await applyAccountStatus(rawPrisma, siteId, settings, {
      accountId: ACCT, chargesEnabled: true, payoutsEnabled: true,
      detailsSubmitted: true, currentlyDue: [], disabledReason: null,
    })
    expect(out.state).toBe('ready')
  })
})

/**
 * The webhook resolves a tenant by stripe_account_id, so that mapping has to be
 * unique. Stripe's ids are globally unique in reality, but "in reality" is not a
 * constraint — and a duplicate would apply one tenant's account status to another
 * tenant's shop, switching payments on or off for a business that never touched Stripe.
 */
describe('one Stripe account belongs to one site', () => {
  it('the database refuses to let two sites share an account id', async () => {
    const otherSite = randomUUID()
    await rawPrisma.sites.create({
      data: { id: otherSite, org_id: orgId, name: 'Second', slug: `second-${otherSite.slice(0, 8)}`, status: 'draft' },
    })
    await startStripeOnboarding(rawPrisma, siteId, urls)

    await expect(
      rawPrisma.store_settings.create({ data: { site_id: otherSite, stripe_account_id: ACCT } }),
    ).rejects.toThrow()
  })

  it('but any number of sites can have no account yet', async () => {
    const a = randomUUID()
    const b = randomUUID()
    for (const id of [a, b])
      await rawPrisma.sites.create({
        data: { id, org_id: orgId, name: 'No shop', slug: `noshop-${id.slice(0, 8)}`, status: 'draft' },
      })
    await ensureStoreSettings(rawPrisma, a)
    await expect(ensureStoreSettings(rawPrisma, b)).resolves.toBeTruthy()
  })
})
