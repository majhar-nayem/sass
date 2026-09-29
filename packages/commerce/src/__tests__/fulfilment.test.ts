import { describe, expect, it } from 'vitest'
import {
  fulfilmentOptions,
  hasAnyFulfilment,
  parsePostcodeList,
  resolveFulfilment,
  type FulfilmentSettings,
} from '../fulfilment.js'

const settings = (over: Partial<FulfilmentSettings> = {}): FulfilmentSettings => ({
  pickup: { enabled: true, address: '12 Main St, Salisbury SA 5108', instructions: 'Side door, 7am–5pm' },
  delivery: { enabled: true, postcodes: ['5108', '5109', '5110'], feeCents: 800, minCents: 5000 },
  post: [{ id: 'std', name: 'Standard post', priceCents: 1200, freeOverCents: 15000, states: [] }],
  ...over,
})
const addr = { name: 'Jane Citizen', line1: '4 Oak Ave', suburb: 'Salisbury', state: 'SA', postcode: '5108' }

/** The acceptance criterion's case: a butcher who only ever does pickup. */
describe('a pickup-only shop', () => {
  const pickupOnly = settings({ delivery: { enabled: false, postcodes: [], feeCents: 0, minCents: null }, post: [] })

  it('offers exactly one option, free, with the address and instructions', () => {
    expect(fulfilmentOptions(pickupOnly, 3000)).toEqual([
      expect.objectContaining({ id: 'pickup', priceCents: 0, needsAddress: false, detail: '12 Main St, Salisbury SA 5108\nSide door, 7am–5pm' }),
    ])
  })

  it('asks the customer for no address at all', () => {
    const r = resolveFulfilment(pickupOnly, 3000, { optionId: 'pickup' })
    expect(r).toMatchObject({ ok: true, method: 'pickup', priceCents: 0, address: null })
  })

  // "Pickup is on" with nowhere to pick up from is not a pickup option.
  it('does not count as fulfilment until there is an address to come to', () => {
    const noAddress = settings({ pickup: { enabled: true, address: '  ', instructions: null }, delivery: { enabled: false, postcodes: [], feeCents: 0, minCents: null }, post: [] })
    expect(hasAnyFulfilment(noAddress)).toBe(false)
    expect(fulfilmentOptions(noAddress, 3000)).toEqual([])
  })
})

describe('a shop with no way to get an order to anyone', () => {
  it('has no fulfilment, and so must not take orders', () => {
    expect(hasAnyFulfilment(settings({ pickup: { enabled: false, address: null, instructions: null }, delivery: { enabled: false, postcodes: [], feeCents: 0, minCents: null }, post: [] }))).toBe(false)
  })
})

describe('local delivery', () => {
  it('delivers to a listed postcode, at the fee', () => {
    expect(resolveFulfilment(settings(), 6000, { optionId: 'delivery', address: addr })).toMatchObject({ ok: true, priceCents: 800 })
  })

  it('refuses a postcode outside the area, and says pickup is still possible', () => {
    const r = resolveFulfilment(settings(), 6000, { optionId: 'delivery', address: { ...addr, postcode: '5000' } })
    expect(r).toEqual({ ok: false, reason: "Sorry, we don't deliver to 5000. You can still pick up." })
  })

  // Shown rather than hidden, so the customer can add something rather than leave.
  it('shows the minimum order instead of hiding delivery below it', () => {
    const o = fulfilmentOptions(settings(), 3000).find((x) => x.id === 'delivery')!
    expect(o.unavailable).toBe('Minimum order for delivery is $50.00')
    expect(resolveFulfilment(settings(), 3000, { optionId: 'delivery', address: addr })).toMatchObject({ ok: false })
  })

  it('needs a real address', () => {
    expect(resolveFulfilment(settings(), 6000, { optionId: 'delivery', address: { postcode: '5108' } })).toMatchObject({ ok: false })
    expect(resolveFulfilment(settings(), 6000, { optionId: 'delivery', address: { ...addr, postcode: '51O8' } })).toMatchObject({ ok: false })
  })
})

describe('post', () => {
  it('charges the flat rate', () => {
    expect(resolveFulfilment(settings(), 6000, { optionId: 'std', address: addr })).toMatchObject({ ok: true, priceCents: 1200 })
  })

  it('is free over the threshold, and the label says so', () => {
    const o = fulfilmentOptions(settings(), 15000).find((x) => x.id === 'std')!
    expect(o).toMatchObject({ priceCents: 0, label: 'Standard post (free)' })
  })

  it('tells the customer how close they are to free post', () => {
    expect(fulfilmentOptions(settings(), 6000).find((x) => x.id === 'std')!.detail).toBe('Free over $150.00')
  })

  it('respects a rate limited to some states', () => {
    const s = settings({ post: [{ id: 'sa', name: 'SA post', priceCents: 900, freeOverCents: null, states: ['SA'] }] })
    expect(resolveFulfilment(s, 6000, { optionId: 'sa', address: { ...addr, state: 'VIC', postcode: '3000' } })).toMatchObject({ ok: false })
    expect(resolveFulfilment(s, 6000, { optionId: 'sa', address: addr })).toMatchObject({ ok: true })
  })
})

describe('what the browser cannot decide', () => {
  it('not having chosen yet asks them to choose', () => {
    expect(resolveFulfilment(settings(), 6000, { optionId: '' })).toEqual({ ok: false, reason: 'Choose how you would like to get your order.' })
  })

  it('an option that is not offered is refused', () => {
    expect(resolveFulfilment(settings(), 6000, { optionId: 'free-helicopter' })).toMatchObject({ ok: false })
  })

  it('the price is the business’s, whatever was posted', () => {
    const r = resolveFulfilment(settings(), 6000, { optionId: 'delivery', address: addr, priceCents: 0 } as never)
    expect(r).toMatchObject({ ok: true, priceCents: 800 })
  })
})

describe('typing a delivery area', () => {
  it('accepts commas, spaces and semicolons', () => {
    expect(parsePostcodeList('5108, 5109 5110;5111').postcodes).toEqual(['5108', '5109', '5110', '5111'])
  })

  it('expands a range, because metro areas are contiguous runs', () => {
    expect(parsePostcodeList('5106-5110').postcodes).toEqual(['5106', '5107', '5108', '5109', '5110'])
  })

  // 5000-9000 is a typo for 5000-5090, not a request to deliver to four thousand places.
  it('refuses an implausibly wide range instead of guessing', () => {
    const r = parsePostcodeList('5000-9000')
    expect(r.postcodes).toEqual([])
    expect(r.rejected).toEqual(['5000-9000'])
  })

  it('reports what it could not read', () => {
    expect(parsePostcodeList('5108, abc, 51099').rejected).toEqual(['abc', '51099'])
  })
})
