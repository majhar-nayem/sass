import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rawPrisma } from '@awning/db'
import { __setStripe } from '@awning/integrations/stripe'
import { __setTransport, __useCapturingTransport } from '@awning/integrations/mail'
import { receiveConnectEvent } from '../connect-webhook.js'
import { notifyOrder, retryUnnotifiedOrders } from '../order-mail.js'

/**
 * M-07. "Duplicate webhook creates one order and decrements once."
 *
 * Tested the hard way: sequential duplicates, concurrent duplicates, and two DIFFERENT
 * events for the same session racing each other — because Stripe does all three.
 */
const orgId = randomUUID()
const siteId = randomUUID()
const ACCT = `acct_${siteId.replace(/-/g, '').slice(0, 16)}`
const otherOrg = randomUUID()
const otherSite = randomUUID()
const OTHER_ACCT = `acct_${otherSite.replace(/-/g, '').slice(0, 16)}`

const ham = randomUUID() // tracked, 10 in stock
const beef = randomUUID() // untracked, GST-free
const theirs = randomUUID() // another tenant's product, tracked

const lineItems = new Map<string, Stripe.LineItem[]>()
const listLineItems = vi.fn(async (sessionId: string) => ({ data: lineItems.get(sessionId) ?? [] }))
let mail: { sent: Array<{ to: string; subject: string; text: string }> }

const li = (productId: string | null, title: string, qty: number, unit: number, gstFree = false): Stripe.LineItem =>
  ({
    description: title,
    quantity: qty,
    amount_total: qty * unit,
    price: { unit_amount: unit, product: { metadata: productId ? { product_id: productId, gst_free: gstFree ? '1' : '0' } : {} } },
  }) as unknown as Stripe.LineItem

let n = 0
function session(lines: Stripe.LineItem[], over: Partial<Stripe.Checkout.Session> = {}) {
  const id = `cs_test_ord${++n}_${randomUUID().slice(0, 6)}`
  lineItems.set(id, lines)
  const total = lines.reduce((s, l) => s + (l.amount_total ?? 0), 0)
  return {
    id,
    object: 'checkout.session',
    payment_status: 'paid',
    payment_intent: `pi_${id}`,
    amount_subtotal: total,
    amount_total: total,
    metadata: { site_id: siteId, platform: 'awning' },
    customer_details: { email: 'jane@example.test', name: 'Jane Citizen', phone: '0412 345 678' },
    ...over,
  } as unknown as Stripe.Checkout.Session
}
const event = (type: string, s: Stripe.Checkout.Session, id = `evt_${randomUUID().slice(0, 12)}`, account = ACCT) =>
  ({ id, type, account, data: { object: s } }) as unknown as Stripe.Event

const orders = () => rawPrisma.orders.findMany({ where: { site_id: siteId }, include: { order_items: true } })
const stock = async (id: string) => (await rawPrisma.products.findUnique({ where: { id } }))!.inventory_qty

beforeAll(async () => {
  for (const [o, s, a] of [[orgId, siteId, ACCT], [otherOrg, otherSite, OTHER_ACCT]] as const) {
    await rawPrisma.organizations.create({
      data: { id: o, name: 'Meats', slug: `ord-${o.slice(0, 8)}`, state: 'SA', gst_registered: true, billing_email: 'owner@example.test' },
    })
    await rawPrisma.sites.create({ data: { id: s, org_id: o, name: "Dave's Meats", slug: `ord-${s.slice(0, 8)}`, status: 'published' } })
    await rawPrisma.store_settings.create({ data: { site_id: s, stripe_account_id: a, stripe_onboarded_at: new Date() } })
  }
  await rawPrisma.products.createMany({
    data: [
      { id: ham, site_id: siteId, title: 'Christmas Ham', slug: `h-${ham.slice(0, 6)}`, price_cents: 6800, status: 'active', track_inventory: true, inventory_qty: 10 },
      { id: beef, site_id: siteId, title: 'Diced Beef', slug: `b-${beef.slice(0, 6)}`, price_cents: 2250, status: 'active', gst_free: true, track_inventory: false },
      { id: theirs, site_id: otherSite, title: 'Their Turkey', slug: `t-${theirs.slice(0, 6)}`, price_cents: 5000, status: 'active', track_inventory: true, inventory_qty: 7 },
    ],
  })
})

beforeEach(async () => {
  await rawPrisma.orders.deleteMany({ where: { site_id: { in: [siteId, otherSite] } } })
  await rawPrisma.products.update({ where: { id: ham }, data: { inventory_qty: 10 } })
  await rawPrisma.products.update({ where: { id: theirs }, data: { inventory_qty: 7 } })
  listLineItems.mockClear()
  __setStripe({ checkout: { sessions: { listLineItems } } } as unknown as Stripe)
  mail = __useCapturingTransport() as typeof mail
})
afterEach(() => __setStripe(null))
afterAll(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: { in: [orgId, otherOrg] } } })
  __setTransport(null)
})

describe('the acceptance criterion', () => {
  it('one paid session makes one order and takes stock once', async () => {
    const s = session([li(ham, 'Christmas Ham', 2, 6800)])
    const r = await receiveConnectEvent(event('checkout.session.completed', s))
    expect(r).toMatchObject({ kind: 'order', outcome: { kind: 'created-paid' } })
    expect(await orders()).toHaveLength(1)
    expect(await stock(ham)).toBe(8)
  })

  it('a redelivered event is a duplicate: still one order, stock taken once', async () => {
    const e = event('checkout.session.completed', session([li(ham, 'Christmas Ham', 2, 6800)]))
    await receiveConnectEvent(e)
    expect(await receiveConnectEvent(e)).toEqual({ kind: 'duplicate' })
    expect(await orders()).toHaveLength(1)
    expect(await stock(ham)).toBe(8)
  })

  it('five simultaneous deliveries of one event: one order, stock taken once', async () => {
    const e = event('checkout.session.completed', session([li(ham, 'Christmas Ham', 3, 6800)]))
    await Promise.all(Array.from({ length: 5 }, () => receiveConnectEvent(e)))
    expect(await orders()).toHaveLength(1)
    expect(await stock(ham)).toBe(7)
  })

  // Two DIFFERENT event ids for one session. Event-level dedupe cannot catch this;
  // only the order row and the per-site lock can.
  it('completed and async_payment_succeeded for one session, at once: one order, stock taken once', async () => {
    const s = session([li(ham, 'Christmas Ham', 2, 6800)])
    await Promise.all([
      receiveConnectEvent(event('checkout.session.completed', s)),
      receiveConnectEvent(event('checkout.session.async_payment_succeeded', s)),
      receiveConnectEvent(event('checkout.session.completed', s)),
    ])
    expect(await orders()).toHaveLength(1)
    expect(await stock(ham)).toBe(8)
  })
})

describe('a payment that settles later', () => {
  it('records a pending order and takes NO stock until it is paid', async () => {
    const s = session([li(ham, 'Christmas Ham', 2, 6800)], { payment_status: 'unpaid' })
    await receiveConnectEvent(event('checkout.session.completed', s))
    expect((await orders())[0]!.status).toBe('pending')
    expect(await stock(ham)).toBe(10)
    expect(mail.sent).toHaveLength(0)
  })

  it('takes the stock, once, when it settles', async () => {
    const s = session([li(ham, 'Christmas Ham', 2, 6800)], { payment_status: 'unpaid' })
    await receiveConnectEvent(event('checkout.session.completed', s))
    await receiveConnectEvent(event('checkout.session.async_payment_succeeded', s))
    await receiveConnectEvent(event('checkout.session.async_payment_succeeded', s)) // a second, distinct event
    const [o] = await orders()
    expect(o!.status).toBe('paid')
    expect(await stock(ham)).toBe(8)
  })

  it('cancels it, without touching stock, when it fails', async () => {
    const s = session([li(ham, 'Christmas Ham', 2, 6800)], { payment_status: 'unpaid' })
    await receiveConnectEvent(event('checkout.session.completed', s))
    await receiveConnectEvent(event('checkout.session.async_payment_failed', s))
    expect((await orders())[0]!.status).toBe('cancelled')
    expect(await stock(ham)).toBe(10)
  })
})

/**
 * A connected Standard account belongs to the tenant, and Connect delivers everything
 * that happens on it. The tenant can also create sessions there themselves.
 */
describe('what is not ours to act on', () => {
  it('ignores the tenant’s other Stripe sales, and does not even call Stripe', async () => {
    const s = session([li(ham, 'Christmas Ham', 1, 6800)], { metadata: { site_id: siteId } })
    expect(await receiveConnectEvent(event('checkout.session.completed', s))).toEqual({ kind: 'ignored', reason: 'not-ours' })
    expect(listLineItems).not.toHaveBeenCalled()
    expect(await orders()).toHaveLength(0)
  })

  it('ignores a session that claims to be a site other than the account’s own', async () => {
    const s = session([li(ham, 'Christmas Ham', 1, 6800)], { metadata: { site_id: otherSite, platform: 'awning' } })
    const r = await receiveConnectEvent(event('checkout.session.completed', s))
    expect(r).toMatchObject({ outcome: { kind: 'ignored', reason: 'site-mismatch' } })
    expect(await rawPrisma.orders.count({ where: { site_id: { in: [siteId, otherSite] } } })).toBe(0)
  })

  // A tenant writing a competitor's product id into their own session's metadata.
  it('never takes stock from another tenant’s product, whatever the metadata says', async () => {
    const s = session([li(theirs, 'Their Turkey', 3, 5000)])
    await receiveConnectEvent(event('checkout.session.completed', s))
    expect(await stock(theirs)).toBe(7)
    const [o] = await orders()
    expect(o!.order_items[0]!.product_id).toBeNull()
  })

  it('ignores an account nobody has connected', async () => {
    const s = session([li(ham, 'Christmas Ham', 1, 6800)])
    expect(await receiveConnectEvent(event('checkout.session.completed', s, undefined, 'acct_nobody'))).toMatchObject({
      reason: 'unknown-account',
    })
  })
})

/** The money has been taken. None of these may lose the order. */
describe('a paid order is never dropped', () => {
  it('records a line whose product was deleted since checkout', async () => {
    const gone = randomUUID()
    const s = session([li(gone, 'Discontinued Sausages', 1, 1500)])
    await receiveConnectEvent(event('checkout.session.completed', s))
    const [o] = await orders()
    expect(o!.order_items[0]).toMatchObject({ product_id: null, title: 'Discontinued Sausages', quantity: 1 })
  })

  it('records an oversell as negative stock, and tells the owner so', async () => {
    const s = session([li(ham, 'Christmas Ham', 13, 6800)])
    const r = await receiveConnectEvent(event('checkout.session.completed', s))
    expect(r).toMatchObject({ outcome: { kind: 'created-paid', oversold: [{ title: 'Christmas Ham', by: 3 }] } })
    expect(await stock(ham)).toBe(-3)
    const ownerMail = mail.sent.find((m) => m.to === 'owner@example.test')!
    expect(ownerMail.text).toMatch(/OVERSOLD/)
    expect(ownerMail.text).toMatch(/Christmas Ham: short by 3/)
  })

  it('records an order with no email address rather than refusing it', async () => {
    const s = session([li(beef, 'Diced Beef', 1, 2250, true)], { customer_details: { email: null, name: 'X', phone: null } as never })
    await receiveConnectEvent(event('checkout.session.completed', s))
    const [o] = await orders()
    expect(o!.email).toBe('')
    expect(mail.sent.map((m) => m.to)).toEqual(['owner@example.test'])
  })

  it('is retried in full when Stripe could not be reached for the line items', async () => {
    const e = event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)]))
    listLineItems.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(receiveConnectEvent(e)).rejects.toThrow()
    expect(await orders()).toHaveLength(0)
    await receiveConnectEvent(e) // Stripe's retry
    expect(await orders()).toHaveLength(1)
    expect(await stock(ham)).toBe(9)
  })
})

describe('what the order says', () => {
  // Fresh meat is GST-free; a ham is not. GST as QUOTED at checkout, per line.
  it('records GST from the treatment quoted at checkout', async () => {
    const s = session([li(ham, 'Christmas Ham', 1, 6800, false), li(beef, 'Diced Beef', 2, 2250, true)])
    await receiveConnectEvent(event('checkout.session.completed', s))
    const [o] = await orders()
    expect(o!.total_cents).toBe(6800 + 4500)
    expect(o!.gst_cents).toBe(618) // round(6800 / 11); the beef carries none
  })

  it('numbers orders from 1, and never twice, even when they arrive together', async () => {
    await Promise.all(
      Array.from({ length: 6 }, () => receiveConnectEvent(event('checkout.session.completed', session([li(beef, 'Diced Beef', 1, 2250, true)])))),
    )
    const numbers = (await orders()).map((o) => o.order_number).sort((a, b) => a - b)
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('telling people', () => {
  it('emails the owner and the customer, once each', async () => {
    const e = event('checkout.session.completed', session([li(ham, 'Christmas Ham', 2, 6800)]))
    await receiveConnectEvent(e)
    await receiveConnectEvent(e)
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['jane@example.test', 'owner@example.test'])
    const owner = mail.sent.find((m) => m.to === 'owner@example.test')!
    // Actionable from a lock screen, like the enquiry email.
    expect(owner.subject).toBe('New order #1 — 0412 345 678 (Jane Citizen)')
    const [o] = await orders()
    expect(o!.owner_notified_at).toBeInstanceOf(Date)
    expect(o!.customer_notified_at).toBeInstanceOf(Date)
  })

  it('sends the customer’s confirmation from the business, not from "Awning"', async () => {
    await receiveConnectEvent(event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)])))
    const customer = mail.sent.find((m) => m.to === 'jane@example.test') as unknown as { from: { name: string; address: string } }
    expect(customer.from).toMatchObject({ name: "Dave's Meats via Awning" })
  })

  // A business name is tenant-controlled. Built into a header by hand, a line break in
  // it writes extra headers — Bcc included.
  it('cannot be used to inject mail headers through the business name', async () => {
    await rawPrisma.sites.update({ where: { id: siteId }, data: { name: "Dave's\r\nBcc: attacker@evil.test" } })
    await receiveConnectEvent(event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)])))
    const customer = mail.sent.find((m) => m.to === 'jane@example.test') as unknown as { from: { name: string } }
    expect(customer.from.name).not.toMatch(/[\r\n]/)
    await rawPrisma.sites.update({ where: { id: siteId }, data: { name: "Dave's Meats" } })
  })

  /**
   * M-08. The customer's email carries the receipt; without a valid ABN on the account
   * it must not be headed "Tax invoice", and the owner is told what to fix.
   */
  it('sends a receipt, not a tax invoice, while the account has no ABN — and tells the owner why', async () => {
    await receiveConnectEvent(event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)])))
    const customer = mail.sent.find((m) => m.to === 'jane@example.test')!
    expect(customer.text).toMatch(/^RECEIPT$/m)
    expect(customer.text).not.toMatch(/^TAX INVOICE$/m)
    const owner = mail.sent.find((m) => m.to === 'owner@example.test')!
    expect(owner.text).toMatch(/receipt, not a tax invoice/)
    expect(owner.text).toMatch(/no ABN/)
  })

  it('sends a tax invoice once the account has a valid ABN, with each line’s GST shown', async () => {
    await rawPrisma.organizations.update({ where: { id: orgId }, data: { abn: '51824753556' } })
    const s = session([li(ham, 'Christmas Ham', 1, 6800, false), li(beef, 'Diced Beef', 2, 2250, true)])
    await receiveConnectEvent(event('checkout.session.completed', s))
    const customer = mail.sent.find((m) => m.to === 'jane@example.test')!
    expect(customer.text).toMatch(/^TAX INVOICE$/m)
    expect(customer.text).toMatch(/ABN 51 824 753 556/)
    expect(customer.text).toMatch(/Christmas Ham.*incl\. GST/)
    expect(customer.text).toMatch(/Diced Beef.*GST-free/)
    expect(customer.text).toMatch(/GST included on taxable items: \$6\.18/)
    const owner = mail.sent.find((m) => m.to === 'owner@example.test')!
    expect(owner.text).not.toMatch(/not a tax invoice/)
    await rawPrisma.organizations.update({ where: { id: orgId }, data: { abn: null } })
  })

  /**
   * Mail is sent after the order commits, so a mail failure cannot lose the order — but
   * it can lose the owner's knowledge of it. The stamp is only set on success, and the
   * next delivery of the event tries again.
   */
  it('keeps the order when mail fails, and finishes the email on the next delivery', async () => {
    __setTransport({ sendMail: async () => { throw new Error('smtp down') } } as never)
    const e = event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)]))
    await receiveConnectEvent(e)
    let [o] = await orders()
    expect(o!.status).toBe('paid')
    expect(o!.owner_notified_at).toBeNull()

    mail = __useCapturingTransport() as typeof mail
    expect(await receiveConnectEvent(e)).toEqual({ kind: 'duplicate' })
    ;[o] = await orders()
    expect(o!.owner_notified_at).toBeInstanceOf(Date)
    expect(mail.sent.some((m) => m.to === 'owner@example.test')).toBe(true)
    expect(await stock(ham)).toBe(9) // and still only taken once
  })
})

/**
 * Found end to end, not here: five simultaneous deliveries made one order — and five
 * customer emails and four owner emails. The sequential test above could never see it.
 */
describe('telling people, when deliveries arrive together', () => {
  const to = (who: string) => mail.sent.filter((m) => m.to === who).length

  it('five simultaneous deliveries send the owner ONE email and the customer ONE', async () => {
    const e = event('checkout.session.completed', session([li(ham, 'Christmas Ham', 2, 6800)]))
    await Promise.all(Array.from({ length: 5 }, () => receiveConnectEvent(e)))
    expect(to('owner@example.test')).toBe(1)
    expect(to('jane@example.test')).toBe(1)
  })

  it('many notifiers racing on one order still send once', async () => {
    __setTransport({ sendMail: async () => { throw new Error('down') } } as never)
    const e = event('checkout.session.completed', session([li(beef, 'Diced Beef', 1, 2250, true)]))
    await receiveConnectEvent(e) // order recorded, mail failed, nothing stamped
    mail = __useCapturingTransport() as typeof mail
    const [o] = await orders()
    await Promise.all(Array.from({ length: 8 }, () => notifyOrder(rawPrisma, o!.id)))
    expect(to('owner@example.test')).toBe(1)
    expect(to('jane@example.test')).toBe(1)
  })

  // A sender that died mid-send must not hold the order forever.
  it('an expired lease is taken over', async () => {
    __setTransport({ sendMail: async () => { throw new Error('down') } } as never)
    await receiveConnectEvent(event('checkout.session.completed', session([li(beef, 'Diced Beef', 1, 2250, true)])))
    const [o] = await orders()
    await rawPrisma.orders.update({ where: { id: o!.id }, data: { notify_lease_until: new Date(Date.now() - 1000) } })
    mail = __useCapturingTransport() as typeof mail
    expect((await notifyOrder(rawPrisma, o!.id)).owner).toBe(true)
  })

  it('a live lease is respected', async () => {
    __setTransport({ sendMail: async () => { throw new Error('down') } } as never)
    await receiveConnectEvent(event('checkout.session.completed', session([li(beef, 'Diced Beef', 1, 2250, true)])))
    const [o] = await orders()
    await rawPrisma.orders.update({ where: { id: o!.id }, data: { notify_lease_until: new Date(Date.now() + 60_000) } })
    mail = __useCapturingTransport() as typeof mail
    expect(await notifyOrder(rawPrisma, o!.id)).toMatchObject({ skipped: 'in-progress-or-done' })
    expect(mail.sent).toHaveLength(0)
  })

  /**
   * Stripe does not redeliver an event we answered 200, so a mail that failed after a
   * successful webhook needs a sweep that does not depend on Stripe at all.
   */
  it('the cron sweep finishes an email that failed after a successful webhook', async () => {
    __setTransport({ sendMail: async () => { throw new Error('down') } } as never)
    await receiveConnectEvent(event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)])))
    mail = __useCapturingTransport() as typeof mail
    const r = await retryUnnotifiedOrders(rawPrisma)
    expect(r.ownerSent).toBeGreaterThanOrEqual(1)
    expect(to('owner@example.test')).toBe(1)
    expect((await orders())[0]!.owner_notified_at).toBeInstanceOf(Date)
  })

  it('the sweep leaves an order alone once the owner has been told', async () => {
    await receiveConnectEvent(event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)])))
    mail = __useCapturingTransport() as typeof mail
    await retryUnnotifiedOrders(rawPrisma)
    expect(to('owner@example.test')).toBe(0)
  })
})

/** M-09. How the customer is getting it, as chosen and checked before they paid. */
describe('delivery and pickup on the order', () => {
  const fee = (cents: number, label = 'Local delivery') =>
    ({ description: label, quantity: 1, amount_total: cents, price: { unit_amount: cents, product: { metadata: { kind: 'fulfilment' } } } }) as unknown as Stripe.LineItem
  const shipTo = { name: 'Jane Citizen', line1: '4 Oak Ave', suburb: 'Salisbury', state: 'SA', postcode: '5108' }

  it('records a delivery: method, address, and the fee kept apart from the goods', async () => {
    const s = session([li(ham, 'Christmas Ham', 1, 6000), li(beef, 'Diced Beef', 1, 4000, true), fee(1000)], {
      metadata: { site_id: siteId, platform: 'awning', fulfilment: 'local_delivery', fulfilment_label: 'Local delivery', ship_to: JSON.stringify(shipTo) },
    })
    await receiveConnectEvent(event('checkout.session.completed', s))
    const [o] = await orders()
    expect(o).toMatchObject({ fulfilment: 'local_delivery', shipping_cents: 1000, subtotal_cents: 10000, total_cents: 11000 })
    expect(o!.ship_to).toMatchObject({ postcode: '5108' })
    // The fee is not a product: two goods lines, and no stock movement for it.
    expect(o!.order_items).toHaveLength(2)
    // GSTR 2001/8: 60% of the delivery follows the taxable ham. (6000 + 600) / 11 = 600.
    expect(o!.gst_cents).toBe(600)
  })

  it('tells the butcher where to deliver, and the customer where it is going', async () => {
    const s = session([li(beef, 'Diced Beef', 2, 2250, true), fee(800)], {
      metadata: { site_id: siteId, platform: 'awning', fulfilment: 'local_delivery', fulfilment_label: 'Local delivery', ship_to: JSON.stringify(shipTo) },
    })
    await receiveConnectEvent(event('checkout.session.completed', s))
    const owner = mail.sent.find((m) => m.to === 'owner@example.test')!
    expect(owner.text).toMatch(/LOCAL DELIVERY — deliver to:\nJane Citizen\n4 Oak Ave\nSalisbury SA 5108/)
    const customer = mail.sent.find((m) => m.to === 'jane@example.test')!
    expect(customer.text).toMatch(/Delivering to:\nJane Citizen/)
    // All fresh meat, so the delivery of it is GST-free too.
    expect(customer.text).toMatch(/Local delivery.*GST-free/)
  })

  it('tells the customer where to collect a pickup order, and how', async () => {
    await rawPrisma.store_settings.update({
      where: { site_id: siteId },
      data: { pickup_enabled: true, pickup_address: { text: '12 Main St, Salisbury SA 5108' }, pickup_instructions: 'Side door, 7am–5pm' },
    })
    await receiveConnectEvent(event('checkout.session.completed', session([li(ham, 'Christmas Ham', 1, 6800)], {
      metadata: { site_id: siteId, platform: 'awning', fulfilment: 'pickup' },
    })))
    expect(mail.sent.find((m) => m.to === 'owner@example.test')!.text).toMatch(/^PICKUP — they will come to you\.$/m)
    const customer = mail.sent.find((m) => m.to === 'jane@example.test')!
    expect(customer.text).toMatch(/Collect it from:\n12 Main St, Salisbury SA 5108\nSide door, 7am–5pm/)
  })
})
