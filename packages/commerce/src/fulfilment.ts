/**
 * M-09 -- how the customer gets their order.
 *
 * Four methods and no carrier APIs (docs/06-COMMERCE-BILLING.md): flat-rate post, free
 * post over a threshold, local pickup — for a butcher the PRIMARY method — and local
 * delivery to a list of postcodes. Pure functions, because the rules decide what a
 * customer pays and whether they can order at all.
 *
 * Everything the customer chooses is re-checked on the server at checkout. The choice
 * arrives from the browser; the postcode list, the minimum order and the fee do not.
 */

export interface PickupSettings {
  enabled: boolean
  address: string | null
  instructions: string | null
}

export interface DeliverySettings {
  enabled: boolean
  postcodes: string[]
  feeCents: number
  minCents: number | null
}

export interface PostRate {
  id: string
  name: string
  priceCents: number
  freeOverCents: number | null
  /** Empty means anywhere in Australia. */
  states: string[]
}

export interface FulfilmentSettings {
  pickup: PickupSettings
  delivery: DeliverySettings
  post: PostRate[]
}

export type Method = 'pickup' | 'local_delivery' | 'shipping'

export interface FulfilmentOption {
  /** 'pickup', 'delivery', or a post rate's id. */
  id: string
  method: Method
  label: string
  priceCents: number
  needsAddress: boolean
  /** Why it cannot be chosen right now, in words for the customer. */
  unavailable: string | null
  /** Pickup address and instructions, shown before they commit to coming in. */
  detail: string | null
}

export interface Address {
  name: string
  line1: string
  line2?: string | null
  suburb: string
  state: string
  postcode: string
}

export const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const

const money = (c: number) => `$${(c / 100).toFixed(2)}`

/** A shop with no way to get an order to anyone must not be taking orders. */
export function hasAnyFulfilment(s: FulfilmentSettings): boolean {
  return (s.pickup.enabled && !!s.pickup.address?.trim()) || s.delivery.enabled || s.post.length > 0
}

/** The postcode a person typed, as the four digits it is. */
export function normalisePostcode(input: string): string | null {
  const p = input.replace(/\D/g, '')
  return /^\d{4}$/.test(p) ? p : null
}

/**
 * Accepts a list the way a butcher would type it: "5000, 5006 5007;5008", and ranges
 * "5000-5010" because metro delivery areas are contiguous runs and nobody should have
 * to type out forty postcodes.
 */
export function parsePostcodeList(input: string): { postcodes: string[]; rejected: string[] } {
  const out = new Set<string>()
  const rejected: string[] = []
  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const range = /^(\d{4})-(\d{4})$/.exec(token)
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y) as [number, number]
      // A typo like 5000-9000 would add 4,000 postcodes. Refuse rather than guess.
      if (b - a > 200) {
        rejected.push(token)
        continue
      }
      for (let p = a; p <= b; p++) out.add(String(p).padStart(4, '0'))
    } else if (/^\d{4}$/.test(token)) out.add(token)
    else rejected.push(token)
  }
  return { postcodes: [...out].sort(), rejected }
}

/** What the customer can choose from, for a cart of this value. */
export function fulfilmentOptions(s: FulfilmentSettings, subtotalCents: number): FulfilmentOption[] {
  const options: FulfilmentOption[] = []

  if (s.pickup.enabled && s.pickup.address?.trim())
    options.push({
      id: 'pickup',
      method: 'pickup',
      label: 'Pick up',
      priceCents: 0,
      needsAddress: false,
      unavailable: null,
      detail: [s.pickup.address.trim(), s.pickup.instructions?.trim()].filter(Boolean).join('\n'),
    })

  if (s.delivery.enabled)
    options.push({
      id: 'delivery',
      method: 'local_delivery',
      label: 'Local delivery',
      priceCents: s.delivery.feeCents,
      needsAddress: true,
      // Shown, not hidden: a customer who sees "delivery from $50" adds a sausage; one
      // who sees no delivery at all rings a competitor.
      unavailable:
        s.delivery.minCents && subtotalCents < s.delivery.minCents
          ? `Minimum order for delivery is ${money(s.delivery.minCents)}`
          : null,
      detail: null,
    })

  for (const r of s.post) {
    const free = r.freeOverCents !== null && subtotalCents >= r.freeOverCents
    options.push({
      id: r.id,
      method: 'shipping',
      label: free ? `${r.name} (free)` : r.name,
      priceCents: free ? 0 : r.priceCents,
      needsAddress: true,
      unavailable: null,
      detail: r.freeOverCents !== null && !free ? `Free over ${money(r.freeOverCents)}` : null,
    })
  }
  return options
}

export type Resolved =
  | { ok: true; method: Method; label: string; priceCents: number; address: Address | null; detail: string | null }
  | { ok: false; reason: string }

/**
 * Checks the customer's choice against the business's own settings, on the server.
 *
 * The choice is posted by a browser, so everything that decides money or eligibility
 * is looked up again here rather than taken from it.
 */
export function resolveFulfilment(
  s: FulfilmentSettings,
  subtotalCents: number,
  choice: { optionId: string; address?: Partial<Address> | null },
): Resolved {
  // Not having chosen yet is not the same as choosing something that is not offered.
  if (!choice.optionId) return { ok: false, reason: 'Choose how you would like to get your order.' }
  const option = fulfilmentOptions(s, subtotalCents).find((o) => o.id === choice.optionId)
  if (!option) return { ok: false, reason: 'That way of getting your order is not offered.' }
  if (option.unavailable) return { ok: false, reason: option.unavailable }
  if (!option.needsAddress)
    return { ok: true, method: option.method, label: option.label, priceCents: option.priceCents, address: null, detail: option.detail }

  const a = choice.address ?? {}
  const postcode = normalisePostcode(a.postcode ?? '')
  const state = (a.state ?? '').toUpperCase()
  if (!a.name?.trim() || !a.line1?.trim() || !a.suburb?.trim())
    return { ok: false, reason: 'Please fill in the name, street and suburb to deliver to.' }
  if (!postcode) return { ok: false, reason: 'Please enter a four-digit Australian postcode.' }
  if (!(STATES as readonly string[]).includes(state)) return { ok: false, reason: 'Please choose a state.' }

  if (option.method === 'local_delivery' && !s.delivery.postcodes.includes(postcode))
    return { ok: false, reason: `Sorry, we don't deliver to ${postcode}. You can still pick up.` }

  if (option.method === 'shipping') {
    const rate = s.post.find((r) => r.id === option.id)!
    if (rate.states.length && !rate.states.includes(state))
      return { ok: false, reason: `${rate.name} is not available to ${state}.` }
  }

  const address: Address = {
    name: a.name.trim().slice(0, 100),
    line1: a.line1.trim().slice(0, 150),
    line2: a.line2?.trim().slice(0, 150) || null,
    suburb: a.suburb.trim().slice(0, 80),
    state,
    postcode,
  }
  return { ok: true, method: option.method, label: option.label, priceCents: option.priceCents, address, detail: null }
}

export function formatAddress(a: Address): string {
  return [a.name, a.line1, a.line2, `${a.suburb} ${a.state} ${a.postcode}`].filter(Boolean).join('\n')
}
