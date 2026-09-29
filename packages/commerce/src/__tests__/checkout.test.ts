import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rawPrisma } from '@awning/db'
import { __setCheckoutStripe, checkoutKeyProblem } from '@awning/integrations/stripe-checkout'
import { buildCheckoutParams, createStorefrontCheckout, MIN_CHARGE_CENTS, verifyCheckoutReturn } from '../checkout.js'
import { resolveCart } from '../storefront.js'

/**
 * M-06. "A test payment settles to the tenant's account, not yours."
 *
 * That is one argument on one call, it fails silently in the wrong direction, and the
 * wrong direction makes the platform a holder of other people's money.
 */
const orgId = randomUUID()
const siteId = randomUUID()
const ACCT = `acct_${siteId.replace(/-/g, '').slice(0, 16)}`
const ORIGIN = 'https://daves-meats.awningsites.com'
const ham = randomUUID()
const beef = randomUUID()
const cheap = randomUUID()

const create = vi.fn()
const retrieve = vi.fn()

beforeAll(async () => {
  await rawPrisma.organizations.create({
    data: { id: orgId, name: 'Daves Meats', slug: `dm-${orgId.slice(0, 8)}`, state: 'SA', gst_registered: true },
  })
  await rawPrisma.subscriptions.create({ data: { org_id: orgId, plan_code: 'store', status: 'active' } })
  await rawPrisma.sites.create({
    data: { id: siteId, org_id: orgId, name: 'Daves Meats', slug: `dm-${siteId.slice(0, 8)}`, status: 'published' },
  })
  await rawPrisma.store_settings.create({
    data: { site_id: siteId, stripe_account_id: ACCT, stripe_onboarded_at: new Date() },
  })
  await rawPrisma.products.createMany({
    data: [
      { id: ham, site_id: siteId, title: 'Christmas Ham', slug: `ham-${ham.slice(0, 6)}`, price_cents: 6800, status: 'active', track_inventory: false },
      { id: beef, site_id: siteId, title: 'Diced Beef', slug: `beef-${beef.slice(0, 6)}`, price_cents: 2250, status: 'active', gst_free: true, track_inventory: false },
      { id: cheap, site_id: siteId, title: 'Sticker', slug: `st-${cheap.slice(0, 6)}`, price_cents: 20, status: 'active', track_inventory: false },
    ],
  })
})

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123' })
  retrieve.mockReset()
  __setCheckoutStripe({ checkout: { sessions: { create, retrieve } } } as unknown as Stripe)
})
afterEach(() => __setCheckoutStripe(null))

const cart = (lines: Array<{ productId: string; qty: number }>) => ({ siteId, issuedAt: 0, lines })

describe('where the money goes', () => {
  it('creates the session ON THE TENANT’S ACCOUNT', async () => {
    const r = await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: ham, qty: 1 }]), ORIGIN)
    expect(r.ok).toBe(true)
    expect(create).toHaveBeenCalledOnce()
    // The acceptance criterion, as an assertion.
    expect(create.mock.calls[0]![1]).toEqual({ stripeAccount: ACCT })
  })

  // Any of these would route money through, or skim it into, the platform balance.
  it('takes no application fee and makes no transfer — a direct charge, nothing else', async () => {
    await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: ham, qty: 1 }]), ORIGIN)
    const params = create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams
    const flat = JSON.stringify(params)
    for (const k of ['application_fee_amount', 'application_fee_percent', 'transfer_data', 'on_behalf_of', 'transfer_group'])
      expect(flat).not.toContain(k)
  })
})

describe('what is charged', () => {
  it('charges today’s database price, not what the cart page showed', async () => {
    await rawPrisma.products.update({ where: { id: ham }, data: { price_cents: 7200 } })
    await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: ham, qty: 2 }]), ORIGIN)
    const line = (create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams).line_items![0]!
    expect(line).toMatchObject({ quantity: 2, price_data: { currency: 'aud', unit_amount: 7200 } })
    await rawPrisma.products.update({ where: { id: ham }, data: { price_cents: 6800 } })
  })

  it('carries our product id on each line, for M-07 to decrement stock', async () => {
    await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: beef, qty: 1 }]), ORIGIN)
    const line = (create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams).line_items![0]!
    expect(line.price_data!.product_data!.metadata).toEqual({ product_id: beef, gst_free: '1' })
  })

  it('pins the session to this site', async () => {
    await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: ham, qty: 1 }]), ORIGIN)
    expect((create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams).metadata).toMatchObject({ site_id: siteId })
  })
})

/**
 * Afterpay on Checkout needs domestic currency and one-time line items, and Stripe shows
 * it through dynamic payment methods — i.e. by NOT naming payment methods. On Connect
 * Standard the tenant switches it on in their own Stripe dashboard.
 */
describe('Afterpay', () => {
  it('does not hard-code payment methods, so the tenant’s own Stripe settings apply', async () => {
    await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: ham, qty: 1 }]), ORIGIN)
    expect(create.mock.calls[0]![0]).not.toHaveProperty('payment_method_types')
  })

  it('meets Afterpay’s conditions: a one-time payment in AUD', async () => {
    await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: ham, qty: 1 }]), ORIGIN)
    const p = create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams
    expect(p.mode).toBe('payment')
    expect(p.line_items!.every((l) => l.price_data?.currency === 'aud' && !l.price_data?.recurring)).toBe(true)
  })
})

describe('when checkout is refused', () => {
  it('an empty cart', async () => {
    expect(await createStorefrontCheckout(rawPrisma, siteId, cart([]), ORIGIN)).toEqual({ ok: false, refusal: 'empty-cart' })
    expect(create).not.toHaveBeenCalled()
  })

  it('a total below Stripe’s minimum', async () => {
    expect(20).toBeLessThan(MIN_CHARGE_CENTS)
    const r = await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: cheap, qty: 1 }]), ORIGIN)
    expect(r).toEqual({ ok: false, refusal: 'below-minimum' })
  })

  // charges_enabled is the only thing that sets stripe_onboarded_at (M-03).
  it('a shop whose payments are not ready', async () => {
    await rawPrisma.store_settings.update({ where: { site_id: siteId }, data: { stripe_onboarded_at: null } })
    const r = await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: ham, qty: 1 }]), ORIGIN)
    expect(r).toEqual({ ok: false, refusal: 'not-accepting-orders' })
    expect(create).not.toHaveBeenCalled()
    await rawPrisma.store_settings.update({ where: { site_id: siteId }, data: { stripe_onboarded_at: new Date() } })
  })

  it('a cart holding only another site’s product, whatever the cookie claims', async () => {
    const r = await createStorefrontCheckout(rawPrisma, siteId, cart([{ productId: randomUUID(), qty: 1 }]), ORIGIN)
    expect(r).toEqual({ ok: false, refusal: 'empty-cart' })
  })
})

/**
 * The return URL carries a session id in a query string — attacker-controlled. It is
 * believed only after Stripe confirms it on THIS site's account.
 */
describe('coming back from Stripe', () => {
  it('looks the session up on this site’s own account', async () => {
    retrieve.mockResolvedValue({ metadata: { site_id: siteId }, payment_status: 'paid' })
    expect(await verifyCheckoutReturn(rawPrisma, siteId, 'cs_test_abc123')).toBe('paid')
    expect(retrieve.mock.calls[0]![1]).toEqual({ stripeAccount: ACCT })
  })

  it('does not call Stripe at all for something that is not a session id', async () => {
    for (const junk of ['', 'abc', 'cs_test_', "cs_test_x'; drop", '../../etc'])
      expect(await verifyCheckoutReturn(rawPrisma, siteId, junk)).toBe('unknown')
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('refuses a session that belongs to another site', async () => {
    retrieve.mockResolvedValue({ metadata: { site_id: randomUUID() }, payment_status: 'paid' })
    expect(await verifyCheckoutReturn(rawPrisma, siteId, 'cs_test_abc123')).toBe('not-ours')
  })

  it('treats an unpaid session as pending, not complete', async () => {
    retrieve.mockResolvedValue({ metadata: { site_id: siteId }, payment_status: 'unpaid' })
    expect(await verifyCheckoutReturn(rawPrisma, siteId, 'cs_test_abc123')).toBe('pending')
  })

  it('says nothing is known when Stripe cannot find it on this account', async () => {
    retrieve.mockRejectedValue(new Error('No such checkout.session'))
    expect(await verifyCheckoutReturn(rawPrisma, siteId, 'cs_test_abc123')).toBe('unknown')
  })
})

describe('the parameters in isolation', () => {
  it('returns the shopper to the site they came from', async () => {
    const resolved = await resolveCart(rawPrisma, siteId, cart([{ productId: ham, qty: 1 }]))
    const { params } = buildCheckoutParams(resolved, { siteId, accountId: ACCT, origin: ORIGIN, businessName: 'x' })
    expect(params.success_url).toBe(`${ORIGIN}/api/checkout/return?session_id={CHECKOUT_SESSION_ID}`)
    expect(params.cancel_url).toBe(`${ORIGIN}/cart`)
  })
})

/**
 * The renderer serves public websites. F-06 gave it no Stripe key on purpose; checkout
 * needs one, so it gets a restricted key and never the full secret.
 */
describe('the checkout key', () => {
  it('is missing when unset', () => {
    expect(checkoutKeyProblem({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('missing')
  })
  it('refuses an unrestricted secret key in production', () => {
    expect(checkoutKeyProblem({ NODE_ENV: 'production', STRIPE_CHECKOUT_KEY: 'sk_live_x' } as NodeJS.ProcessEnv)).toBe(
      'unrestricted-in-production',
    )
  })
  it('accepts a restricted key in production', () => {
    expect(checkoutKeyProblem({ NODE_ENV: 'production', STRIPE_CHECKOUT_KEY: 'rk_live_x' } as NodeJS.ProcessEnv)).toBeNull()
  })
  it('tolerates a test secret key outside production', () => {
    expect(checkoutKeyProblem({ NODE_ENV: 'development', STRIPE_CHECKOUT_KEY: 'sk_test_x' } as NodeJS.ProcessEnv)).toBeNull()
  })
})
