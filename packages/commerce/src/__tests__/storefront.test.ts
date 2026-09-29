import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { rawPrisma } from '@awning/db'
import { applyCartAction, listStorefrontProducts, resolveCart, shopStatus, storefrontProduct } from '../storefront.js'

/**
 * M-05. A shopper has no org, so every query here is filtered by site explicitly —
 * which makes that filter the isolation boundary, and makes it worth testing directly.
 */
const orgId = randomUUID()
const siteId = randomUUID()
const otherOrg = randomUUID()
const otherSite = randomUUID()

const ids = { ham: randomUUID(), beef: randomUUID(), draft: randomUUID(), soldOut: randomUUID(), theirs: randomUUID() }

async function product(id: string, site: string, over: Record<string, unknown> = {}) {
  await rawPrisma.products.create({
    data: {
      id, site_id: site, title: `P ${id.slice(0, 4)}`, slug: `p-${id.slice(0, 8)}`,
      price_cents: 1000, status: 'active', track_inventory: false, ...over,
    },
  })
}

const cart = (lines: Array<{ productId: string; qty: number }>) => ({ siteId, issuedAt: 0, lines })

beforeAll(async () => {
  for (const [o, s, plan] of [[orgId, siteId, 'store'], [otherOrg, otherSite, 'store']] as const) {
    await rawPrisma.organizations.create({
      data: { id: o, name: 'Shop', slug: `shop-${o.slice(0, 8)}`, state: 'SA', gst_registered: true },
    })
    await rawPrisma.subscriptions.create({ data: { org_id: o, plan_code: plan, status: 'active' } })
    await rawPrisma.sites.create({
      data: { id: s, org_id: o, name: 'Shop', slug: `shop-${s.slice(0, 8)}`, status: 'published' },
    })
  }
  await product(ids.ham, siteId, { title: 'Christmas Ham', price_cents: 6800, gst_free: false })
  await product(ids.beef, siteId, { title: 'Diced Beef', price_cents: 2250, gst_free: true })
  await product(ids.draft, siteId, { status: 'draft' })
  await product(ids.soldOut, siteId, { track_inventory: true, inventory_qty: 0 })
  await product(ids.theirs, otherSite, { title: 'Their product', price_cents: 1 })
})

describe('which sites have a shop', () => {
  it('a published store-plan site with products has one', async () => {
    expect(await rawPrisma.$transaction((db) => shopStatus(db, siteId))).toMatchObject({ enabled: true })
  })

  // Accepting orders needs Stripe to say charges are enabled; M-03 is the only writer.
  it('but does not accept orders until payments are ready', async () => {
    const s = await shopStatus(rawPrisma, siteId)
    expect(s.acceptsOrders).toBe(false)
    expect(s.reason).toBe('payments-not-ready')
  })

  it('accepts orders once they are', async () => {
    await rawPrisma.store_settings.upsert({
      where: { site_id: siteId },
      create: { site_id: siteId, stripe_onboarded_at: new Date(), pickup_enabled: true, pickup_address: { text: '12 Main St' } },
      update: { stripe_onboarded_at: new Date(), pickup_enabled: true, pickup_address: { text: '12 Main St' } },
    })
    expect((await shopStatus(rawPrisma, siteId)).acceptsOrders).toBe(true)
    await rawPrisma.store_settings.update({ where: { site_id: siteId }, data: { stripe_onboarded_at: null } })
  })

  /**
   * The bug this function exists to prevent: the privacy policy read "a store_settings
   * row exists" as "this site takes orders", and the payments screen creates that row
   * just by being opened.
   */
  // M-09. Payments ready but no pickup, delivery or post: money for an order nobody can
  // get to the customer.
  it('does not accept orders with no way to get them to the customer', async () => {
    await rawPrisma.store_settings.upsert({
      where: { site_id: siteId },
      create: { site_id: siteId, stripe_onboarded_at: new Date() },
      update: { stripe_onboarded_at: new Date(), pickup_enabled: false },
    })
    expect(await shopStatus(rawPrisma, siteId)).toMatchObject({ acceptsOrders: false, reason: 'no-fulfilment' })
    await rawPrisma.store_settings.update({ where: { site_id: siteId }, data: { stripe_onboarded_at: null } })
  })

  it('a settings row on its own does not mean the site takes orders', async () => {
    await rawPrisma.store_settings.upsert({
      where: { site_id: siteId }, create: { site_id: siteId }, update: { stripe_onboarded_at: null },
    })
    expect((await shopStatus(rawPrisma, siteId)).acceptsOrders).toBe(false)
  })

  it('a plan without ecommerce has no shop', async () => {
    const o = randomUUID(), s = randomUUID()
    await rawPrisma.organizations.create({ data: { id: o, name: 'B', slug: `b-${o.slice(0, 8)}`, state: 'SA' } })
    await rawPrisma.subscriptions.create({ data: { org_id: o, plan_code: 'business', status: 'active' } })
    await rawPrisma.sites.create({ data: { id: s, org_id: o, name: 'B', slug: `b-${s.slice(0, 8)}`, status: 'published' } })
    await product(randomUUID(), s)
    expect(await shopStatus(rawPrisma, s)).toMatchObject({ enabled: false, reason: 'no-plan' })
  })

  it('a cancelled store plan keeps a brochure site, not a checkout', async () => {
    await rawPrisma.subscriptions.update({ where: { org_id: orgId }, data: { status: 'canceled' } })
    expect((await shopStatus(rawPrisma, siteId)).enabled).toBe(false)
    await rawPrisma.subscriptions.update({ where: { org_id: orgId }, data: { status: 'active' } })
  })
})

describe('what a shopper can see', () => {
  it('never shows a draft', async () => {
    const titles = (await listStorefrontProducts(rawPrisma, siteId)).map((p) => p.id)
    expect(titles).not.toContain(ids.draft)
    expect(await storefrontProduct(rawPrisma, siteId, `p-${ids.draft.slice(0, 8)}`)).toBeNull()
  })

  // The isolation boundary for an org-less request is the site filter itself.
  it('never shows another site’s product, even by its exact slug', async () => {
    expect(await storefrontProduct(rawPrisma, siteId, `p-${ids.theirs.slice(0, 8)}`)).toBeNull()
    expect((await listStorefrontProducts(rawPrisma, siteId)).map((p) => p.id)).not.toContain(ids.theirs)
  })

  it('marks sold-out stock as unavailable rather than hiding it', async () => {
    const p = (await listStorefrontProducts(rawPrisma, siteId)).find((x) => x.id === ids.soldOut)
    expect(p?.available).toBe(false)
  })
})

/**
 * M-08. "Includes GST" is a claim about the price. A business under the GST threshold
 * does not charge it, so for them the claim is false.
 */
describe('what the product page says about GST', () => {
  it('a registered business: "Includes GST", or "GST free" for GST-free lines', async () => {
    const list = await listStorefrontProducts(rawPrisma, siteId)
    expect(list.find((p) => p.id === ids.ham)!.gstNote).toBe('Includes GST')
    expect(list.find((p) => p.id === ids.beef)!.gstNote).toBe('GST free')
  })

  it('a business that is not registered: nothing at all', async () => {
    await rawPrisma.organizations.update({ where: { id: orgId }, data: { gst_registered: false } })
    const list = await listStorefrontProducts(rawPrisma, siteId)
    expect(list.every((p) => p.gstNote === null)).toBe(true)
    await rawPrisma.organizations.update({ where: { id: orgId }, data: { gst_registered: true } })
  })
})

describe('resolving a cart', () => {
  it('prices from the database, never from the cookie', async () => {
    const r = await resolveCart(rawPrisma, siteId, cart([{ productId: ids.ham, qty: 2 }]))
    expect(r.lines[0]).toMatchObject({ unitCents: 6800, lineCents: 13600 })
  })

  it('picks up a price change on the next read', async () => {
    await rawPrisma.products.update({ where: { id: ids.ham }, data: { price_cents: 7200 } })
    const r = await resolveCart(rawPrisma, siteId, cart([{ productId: ids.ham, qty: 1 }]))
    expect(r.subtotalCents).toBe(7200)
    await rawPrisma.products.update({ where: { id: ids.ham }, data: { price_cents: 6800 } })
  })

  // A forged cookie naming another tenant's product must not put it in this cart.
  it('drops another site’s product, whatever the cookie says', async () => {
    const r = await resolveCart(rawPrisma, siteId, cart([{ productId: ids.theirs, qty: 1 }]))
    expect(r.lines).toEqual([])
    expect(r.unavailable).toEqual([{ productId: ids.theirs, reason: 'removed' }])
  })

  it('reports a product that was drafted after it was added, instead of hiding it', async () => {
    const r = await resolveCart(rawPrisma, siteId, cart([{ productId: ids.draft, qty: 1 }]))
    expect(r.unavailable[0]!.reason).toBe('removed')
  })

  it('reports sold-out stock', async () => {
    const r = await resolveCart(rawPrisma, siteId, cart([{ productId: ids.soldOut, qty: 1 }]))
    expect(r.unavailable[0]!.reason).toBe('out-of-stock')
  })

  it('caps a quantity to what is in stock, and says so', async () => {
    const low = randomUUID()
    await product(low, siteId, { track_inventory: true, inventory_qty: 3 })
    const r = await resolveCart(rawPrisma, siteId, cart([{ productId: low, qty: 10 }]))
    expect(r.lines[0]).toMatchObject({ qty: 3, cappedFrom: 10 })
  })
})

/**
 * GST is one eleventh of a GST-inclusive price, per standard-rated line. Fresh meat is
 * GST-free and a butcher's Christmas order contains both.
 */
describe('GST', () => {
  it('includes one eleventh of standard-rated lines only', async () => {
    const r = await resolveCart(
      rawPrisma, siteId,
      cart([{ productId: ids.ham, qty: 1 }, { productId: ids.beef, qty: 2 }]),
    )
    expect(r.subtotalCents).toBe(6800 + 4500)
    // Only the ham carries GST: round(6800 / 11) = 618. The beef is GST-free.
    expect(r.gstCents).toBe(618)
  })

  it('shows no GST for a business that is not registered for it', async () => {
    await rawPrisma.organizations.update({ where: { id: orgId }, data: { gst_registered: false } })
    const r = await resolveCart(rawPrisma, siteId, cart([{ productId: ids.ham, qty: 1 }]))
    expect(r.gstCents).toBe(0)
    expect(r.gstRegistered).toBe(false)
    await rawPrisma.organizations.update({ where: { id: orgId }, data: { gst_registered: true } })
  })
})

describe('changing a cart', () => {
  const empty = () => cart([])

  it('adds, and adding again increases the quantity', async () => {
    const a = await applyCartAction(rawPrisma, siteId, empty(), { action: 'add', productId: ids.ham })
    const b = await applyCartAction(rawPrisma, siteId, a.cart, { action: 'add', productId: ids.ham, qty: 2 })
    expect(b.cart.lines).toEqual([{ productId: ids.ham, qty: 3 }])
  })

  // Otherwise an invented id occupies one of the fifty slots in the cookie.
  it('refuses to add a product this site does not sell', async () => {
    const r = await applyCartAction(rawPrisma, siteId, empty(), { action: 'add', productId: ids.theirs })
    expect(r.rejected).toBe('unknown-product')
    expect(r.cart.lines).toEqual([])
  })

  it('refuses to add a draft', async () => {
    expect((await applyCartAction(rawPrisma, siteId, empty(), { action: 'add', productId: ids.draft })).rejected).toBe(
      'unknown-product',
    )
  })

  it('setting zero removes the line', async () => {
    const a = await applyCartAction(rawPrisma, siteId, empty(), { action: 'add', productId: ids.ham })
    const b = await applyCartAction(rawPrisma, siteId, a.cart, { action: 'set', productId: ids.ham, qty: 0 })
    expect(b.cart.lines).toEqual([])
  })

  it('clears', async () => {
    const a = await applyCartAction(rawPrisma, siteId, empty(), { action: 'add', productId: ids.ham })
    expect((await applyCartAction(rawPrisma, siteId, a.cart, { action: 'clear' })).cart.lines).toEqual([])
  })
})
