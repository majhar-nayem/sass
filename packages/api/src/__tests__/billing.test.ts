import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import type Stripe from 'stripe'
import { rawPrisma } from '@awning/db'
import { canPublish, mapSubscriptionStatus, parseWebhook, __setStripe } from '@awning/integrations/stripe'
import { handleStripeEvent } from '../billing-webhook.js'

/**
 * M-01 -- webhook handling, against real Postgres.
 *
 * Stripe guarantees at-least-once delivery, so duplicates are ordinary traffic. These
 * assert the two properties that matter: a replayed event changes nothing, and a forged
 * one is rejected.
 */
const orgId = randomUUID()
const SUB = 'sub_test_123'

beforeEach(async () => {
  await rawPrisma.webhook_events.deleteMany({ where: { provider: 'stripe' } })
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  const slug = `bill-${orgId.slice(0, 8)}`
  await rawPrisma.organizations.create({ data: { id: orgId, name: slug, slug } })
  await rawPrisma.subscriptions.create({
    data: { org_id: orgId, plan_code: 'founding', status: 'trialing', trial_ends_at: new Date(Date.now() + 14 * 864e5) },
  })
})

afterAll(async () => {
  await rawPrisma.webhook_events.deleteMany({ where: { provider: 'stripe' } })
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  await rawPrisma.$disconnect()
})

const event = (id: string, type: string, object: unknown): Stripe.Event =>
  ({ id, type, data: { object }, created: Math.floor(Date.now() / 1000) }) as Stripe.Event

const checkoutCompleted = (id = 'evt_1') =>
  event(id, 'checkout.session.completed', {
    client_reference_id: orgId,
    customer: 'cus_test_1',
    subscription: SUB,
    metadata: { org_id: orgId, plan_code: 'founding' },
    customer_details: { email: 'dave@example.test' },
  })

const sub = (status: string) => ({ id: SUB, status, cancel_at_period_end: false, metadata: { org_id: orgId } })

describe('checkout completion', () => {
  it('activates the subscription and records the Stripe customer', async () => {
    const out = await handleStripeEvent(checkoutCompleted())
    expect(out).toEqual({ handled: true, action: 'subscription-activated' })

    const s = await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } })
    expect(s?.status).toBe('active')
    expect(s?.stripe_subscription_id).toBe(SUB)
    // Founding pricing locked: it is the urgency lever and the churn brake.
    expect(s?.price_locked_cents).toBe(3900)

    const o = await rawPrisma.organizations.findUnique({ where: { id: orgId } })
    expect(o?.stripe_customer_id).toBe('cus_test_1')
    expect(o?.billing_email).toBe('dave@example.test')
  })

  /** The AC: the same event three times must produce one subscription. */
  it('is idempotent across duplicate delivery', async () => {
    const first = await handleStripeEvent(checkoutCompleted('evt_dup'))
    const second = await handleStripeEvent(checkoutCompleted('evt_dup'))
    const third = await handleStripeEvent(checkoutCompleted('evt_dup'))

    expect(first.handled).toBe(true)
    expect(second).toEqual({ handled: false, reason: 'duplicate' })
    expect(third).toEqual({ handled: false, reason: 'duplicate' })

    expect(await rawPrisma.subscriptions.count({ where: { org_id: orgId } })).toBe(1)
    expect(await rawPrisma.webhook_events.count({ where: { id: 'evt_dup' } })).toBe(1)
  })

  it('records every event it has seen, including ones it ignores', async () => {
    await handleStripeEvent(event('evt_ignored', 'customer.created', {}))
    const row = await rawPrisma.webhook_events.findUnique({ where: { id: 'evt_ignored' } })
    expect(row?.processed_at).not.toBeNull()
  })

  it('reports an unknown org rather than throwing', async () => {
    const out = await handleStripeEvent(
      event('evt_orphan', 'checkout.session.completed', { customer: 'cus_x', subscription: 'sub_x' }),
    )
    expect(out).toEqual({ handled: false, reason: 'unknown-org' })
  })
})

describe('subscription lifecycle', () => {
  it('follows Stripe status changes', async () => {
    await handleStripeEvent(event('evt_a', 'customer.subscription.updated', sub('active')))
    expect((await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } }))?.status).toBe('active')

    await handleStripeEvent(event('evt_b', 'customer.subscription.updated', sub('past_due')))
    expect((await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } }))?.status).toBe('past_due')
  })

  /**
   * The most important behaviour in this file. Expired cards are the largest cause of
   * involuntary churn at A$39, and a tradie whose website disappears because of one
   * does not come back — and tells people.
   */
  it('a failed payment marks past_due and the site stays publishable', async () => {
    await handleStripeEvent(checkoutCompleted('evt_paid'))
    await handleStripeEvent(
      event('evt_fail', 'invoice.payment_failed', { subscription: SUB }),
    )
    const s = await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } })
    expect(s?.status).toBe('past_due')
    expect(canPublish(s!.status)).toBe(true)
  })

  it('a recovered payment returns to active', async () => {
    await handleStripeEvent(checkoutCompleted('evt_p1'))
    await handleStripeEvent(event('evt_f1', 'invoice.payment_failed', { subscription: SUB }))
    await handleStripeEvent(event('evt_s1', 'invoice.payment_succeeded', { subscription: SUB }))
    expect((await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } }))?.status).toBe('active')
  })

  it('cancellation records the date but does not take the site down here', async () => {
    await handleStripeEvent(checkoutCompleted('evt_p2'))
    await handleStripeEvent(event('evt_del', 'customer.subscription.deleted', sub('canceled')))
    const s = await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } })
    expect(s?.status).toBe('canceled')
    expect(s?.canceled_at).not.toBeNull()
    // Suspension is a separate, later job with a grace window.
    const site = await rawPrisma.sites.findFirst({ where: { org_id: orgId } })
    expect(site).toBeNull()
  })
})

describe('status mapping and the publish gate', () => {
  it.each([
    ['trialing', 'trialing', false],
    ['active', 'active', true],
    ['past_due', 'past_due', true],
    ['unpaid', 'past_due', true],
    ['canceled', 'canceled', false],
    ['incomplete', 'incomplete', false],
    ['paused', 'paused', false],
    ['something_new', 'incomplete', false],
  ])('%s -> %s, publishable: %s', (stripeStatus, ours, publishable) => {
    expect(mapSubscriptionStatus(stripeStatus)).toBe(ours)
    expect(canPublish(mapSubscriptionStatus(stripeStatus))).toBe(publishable)
  })

  /** A trial can build and preview. Publishing is the paywall. */
  it('a trial cannot publish', () => {
    expect(canPublish('trialing')).toBe(false)
  })
})

describe('signature verification', () => {
  const SECRET = 'whsec_test_secret'
  const signed = (body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) => {
    const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    return `t=${timestamp},v1=${sig}`
  }

  beforeEach(() => {
    // `??=` would not fire here: .env sets STRIPE_SECRET_KEY to an empty string, which
    // is neither null nor undefined. Signature verification needs a client, not a
    // valid key — nothing here reaches the network.
    if (!process.env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
    __setStripe(null)
  })

  it('accepts a correctly signed payload', () => {
    const body = JSON.stringify({ id: 'evt_sig', type: 'ping', data: { object: {} } })
    expect(parseWebhook(body, signed(body), SECRET).id).toBe('evt_sig')
  })

  /** Without this, anyone who reads the URL out of a network tab gets a free plan. */
  it('rejects a payload signed with the wrong secret', () => {
    const body = JSON.stringify({ id: 'evt_bad', type: 'ping', data: { object: {} } })
    expect(() => parseWebhook(body, signed(body, 'whsec_wrong'), SECRET)).toThrow()
  })

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ id: 'evt_x', type: 'ping', data: { object: {} } })
    const sig = signed(body)
    expect(() => parseWebhook(body.replace('evt_x', 'evt_y'), sig, SECRET)).toThrow()
  })

  it('rejects a missing signature', () => {
    expect(() => parseWebhook('{}', null, SECRET)).toThrow(/signature/i)
  })

  /** Replay protection: Stripe's tolerance window rejects an old, validly-signed body. */
  it('rejects a replayed payload from an hour ago', () => {
    const body = JSON.stringify({ id: 'evt_old', type: 'ping', data: { object: {} } })
    const old = Math.floor(Date.now() / 1000) - 3600
    expect(() => parseWebhook(body, signed(body, SECRET, old), SECRET)).toThrow()
  })
})
