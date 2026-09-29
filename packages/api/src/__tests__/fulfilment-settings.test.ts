import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rawPrisma } from '@awning/db'
import { loadFulfilment, hasAnyFulfilment } from '@awning/commerce'
import { fulfilmentForm, saveFulfilment, type FulfilmentForm } from '../store.js'

/** M-09. "A butcher configures pickup-only in under 2 min." */
const orgId = randomUUID()
const siteId = randomUUID()

beforeAll(async () => {
  await rawPrisma.organizations.create({ data: { id: orgId, name: 'Meats', slug: `ful-${orgId.slice(0, 8)}`, state: 'SA' } })
  await rawPrisma.sites.create({
    data: { id: siteId, org_id: orgId, name: "Dave's Meats", slug: `ful-${siteId.slice(0, 8)}`, status: 'draft', business_address: { suburb: 'Salisbury', state: 'SA', postcode: '5108' } },
  })
})
beforeEach(async () => {
  await rawPrisma.store_settings.deleteMany({ where: { site_id: siteId } })
  await rawPrisma.shipping_rates.deleteMany({ where: { site_id: siteId } })
})

describe('the fulfilment screen, first visit', () => {
  it('pre-fills the pickup address from the business address', async () => {
    expect((await fulfilmentForm(rawPrisma, siteId)).pickup.address).toBe('Salisbury SA 5108')
  })

  // Offering pickup commits someone to being at the counter. Theirs to switch on.
  it('switches nothing on by itself', async () => {
    const f = await fulfilmentForm(rawPrisma, siteId)
    expect([f.pickup.enabled, f.delivery.enabled, f.post.enabled]).toEqual([false, false, false])
  })
})

/**
 * The acceptance criterion, as the minimum a butcher has to do: open the screen, tick
 * pickup, finish the address, save. Everything else is already in the form.
 */
describe('pickup-only', () => {
  it('is one tick, one address and one save', async () => {
    const form = await fulfilmentForm(rawPrisma, siteId)
    const edited: FulfilmentForm = {
      ...form,
      pickup: { ...form.pickup, enabled: true, address: `12 Main St, ${form.pickup.address}` },
    }
    expect(await saveFulfilment(rawPrisma, siteId, edited)).toEqual({ ok: true })

    const f = await loadFulfilment(rawPrisma, siteId)
    expect(f.pickup).toMatchObject({ enabled: true, address: '12 Main St, Salisbury SA 5108' })
    expect(f.delivery.enabled).toBe(false)
    expect(f.post).toEqual([])
    expect(hasAnyFulfilment(f)).toBe(true)
  })
})

describe('what it refuses to save', () => {
  const blank = async (): Promise<FulfilmentForm> => fulfilmentForm(rawPrisma, siteId)

  it('pickup switched on with no address', async () => {
    const f = await blank()
    const r = await saveFulfilment(rawPrisma, siteId, { ...f, pickup: { enabled: true, address: ' ', instructions: '' } })
    expect(r).toMatchObject({ ok: false, problems: [{ field: 'pickup.address' }] })
  })

  it('delivery switched on with no postcodes', async () => {
    const f = await blank()
    const r = await saveFulfilment(rawPrisma, siteId, { ...f, delivery: { enabled: true, postcodes: '', feeCents: 800, minCents: null } })
    expect(r).toMatchObject({ ok: false, problems: [{ field: 'delivery.postcodes' }] })
  })

  it('postcodes it cannot read, naming them', async () => {
    const f = await blank()
    const r = await saveFulfilment(rawPrisma, siteId, { ...f, delivery: { enabled: true, postcodes: '5108, salisbury', feeCents: 800, minCents: null } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems[0]!.message).toMatch(/salisbury/)
  })

  it('everything switched off, which is a shop that cannot sell', async () => {
    const r = await saveFulfilment(rawPrisma, siteId, await blank())
    expect(r).toMatchObject({ ok: false, problems: [{ field: 'all' }] })
  })

  it('and when it refuses, it saves nothing at all', async () => {
    const f = await blank()
    await saveFulfilment(rawPrisma, siteId, { ...f, pickup: { enabled: true, address: '12 Main St', instructions: '' }, delivery: { enabled: true, postcodes: '', feeCents: 800, minCents: null } })
    expect((await loadFulfilment(rawPrisma, siteId)).pickup.enabled).toBe(false)
  })
})

describe('delivery and post', () => {
  it('saves a delivery area typed as a range', async () => {
    const f = await fulfilmentForm(rawPrisma, siteId)
    await saveFulfilment(rawPrisma, siteId, { ...f, delivery: { enabled: true, postcodes: '5106-5109, 5112', feeCents: 800, minCents: 5000 } })
    expect((await loadFulfilment(rawPrisma, siteId)).delivery).toMatchObject({ postcodes: ['5106', '5107', '5108', '5109', '5112'], feeCents: 800, minCents: 5000 })
  })

  it('saves one postage option, and switching it off keeps the details for next time', async () => {
    const f = await fulfilmentForm(rawPrisma, siteId)
    await saveFulfilment(rawPrisma, siteId, { ...f, post: { enabled: true, name: 'Express post', priceCents: 1500, freeOverCents: 20000 } })
    expect((await loadFulfilment(rawPrisma, siteId)).post).toHaveLength(1)
    const again = await fulfilmentForm(rawPrisma, siteId)
    await saveFulfilment(rawPrisma, siteId, { ...again, pickup: { ...again.pickup, enabled: true, address: '12 Main St' }, post: { ...again.post, enabled: false } })
    expect((await loadFulfilment(rawPrisma, siteId)).post).toEqual([])
    expect((await fulfilmentForm(rawPrisma, siteId)).post).toMatchObject({ enabled: false, name: 'Express post', priceCents: 1500 })
  })
})
