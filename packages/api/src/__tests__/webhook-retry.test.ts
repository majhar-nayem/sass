import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, describe, expect, it } from 'vitest'
import { rawPrisma } from '@awning/db'
import { handleStripeEvent } from '../billing-webhook.js'
import { processOnce } from '../webhook-once.js'

/**
 * Stripe retries an event after a 5xx. The retry must be PROCESSED, not refused as a
 * duplicate of the attempt that failed.
 *
 * The billing webhook used to claim the event id with one write and process it with
 * others, outside any transaction. A failure left the claim in place, and the retry was
 * then told "duplicate" — so the event was never applied.
 */
const eventId = () => `evt_retry_${randomUUID().slice(0, 12)}`
const created: string[] = []

afterAll(async () => {
  await rawPrisma.webhook_events.deleteMany({ where: { id: { in: created } } })
  await rawPrisma.organizations.deleteMany({ where: { slug: { startsWith: 'retry-' } } })
})

describe('the billing webhook, after a failed attempt', () => {
  it('processes the retry instead of calling it a duplicate', async () => {
    const orgId = randomUUID()
    const id = eventId()
    created.push(id)
    const event = {
      id,
      type: 'checkout.session.completed',
      created: 0,
      data: {
        object: {
          client_reference_id: orgId,
          customer: 'cus_retry',
          subscription: 'sub_retry',
          metadata: { org_id: orgId, plan_code: 'founding' },
          customer_details: { email: 'retry@example.test' },
        },
      },
    } as unknown as Stripe.Event

    // First delivery: the org it names does not exist yet, so applying it fails —
    // the ordinary shape of a transient error, or of events arriving out of order.
    await expect(handleStripeEvent(event)).rejects.toThrow()

    // The row appears, and Stripe retries the same event.
    const slug = `retry-${orgId.slice(0, 8)}`
    await rawPrisma.organizations.create({ data: { id: orgId, name: slug, slug } })
    await rawPrisma.subscriptions.create({ data: { org_id: orgId, plan_code: 'founding', status: 'trialing' } })

    const second = await handleStripeEvent(event)
    expect(second).not.toMatchObject({ reason: 'duplicate' })
    const org = await rawPrisma.organizations.findUnique({ where: { id: orgId }, select: { stripe_customer_id: true } })
    expect(org?.stripe_customer_id).toBe('cus_retry')
  })
})

describe('processOnce', () => {
  const ev = () => {
    const id = eventId()
    created.push(id)
    return { id, type: 'test.event', payload: { n: 1 } }
  }

  it('runs a handler once and calls every later delivery a duplicate', async () => {
    const e = ev()
    let runs = 0
    const a = await processOnce(e, 'stripe-connect', async () => ++runs)
    const b = await processOnce(e, 'stripe-connect', async () => ++runs)
    expect(a).toEqual({ duplicate: false, result: 1 })
    expect(b).toEqual({ duplicate: true })
    expect(runs).toBe(1)
  })

  it('lets a retry run after a failure', async () => {
    const e = ev()
    await expect(processOnce(e, 'stripe-connect', async () => { throw new Error('transient') })).rejects.toThrow()
    const retry = await processOnce(e, 'stripe-connect', async () => 'applied')
    expect(retry).toEqual({ duplicate: false, result: 'applied' })
  })

  // The real test of the design: two deliveries of one event at the same instant.
  it('runs exactly once under concurrent delivery', async () => {
    const e = ev()
    let runs = 0
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        processOnce(e, 'stripe-connect', async () => {
          runs++
          await new Promise((r) => setTimeout(r, 50)) // hold the row while others arrive
          return 'ok'
        }),
      ),
    )
    expect(runs).toBe(1)
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1)
  })

  it('rolls back the handler’s own writes when it fails', async () => {
    const e = ev()
    const slug = `retry-rb-${randomUUID().slice(0, 6)}`
    await expect(
      processOnce(e, 'stripe-connect', async (db) => {
        await db.organizations.create({ data: { name: slug, slug } })
        throw new Error('after the write')
      }),
    ).rejects.toThrow()
    expect(await rawPrisma.organizations.count({ where: { slug } })).toBe(0)
  })
})
