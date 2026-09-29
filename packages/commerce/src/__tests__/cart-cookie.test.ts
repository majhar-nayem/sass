import { describe, expect, it } from 'vitest'
import { cartCookie, emptyCart, MAX_AGE_SECONDS, MAX_LINES, MAX_QTY, normaliseCart, readCart, signCart } from '../cart-cookie.js'

const SECRET = 'test-secret-for-the-cart-cookie-0123456789'
const SITE = '11111111-1111-4111-8111-111111111111'
const OTHER_SITE = '22222222-2222-4222-8222-222222222222'
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = 1_800_000_000

const cart = (lines = [{ productId: P1, qty: 2 }]) => ({ siteId: SITE, issuedAt: NOW, lines })

describe('a cart survives the round trip', () => {
  it('reads back what was written', async () => {
    const r = await readCart(await signCart(cart(), SECRET), SECRET, SITE, NOW)
    expect(r).toEqual({ ok: true, cart: cart() })
  })

  // The acceptance criterion: a cart survives a reload.
  it('is stable across reads', async () => {
    const c = await signCart(cart(), SECRET)
    expect(await readCart(c, SECRET, SITE, NOW)).toEqual(await readCart(c, SECRET, SITE, NOW + 60))
  })

  it('fits comfortably in a cookie even when full', async () => {
    const full = cart(
      Array.from({ length: MAX_LINES }, (_, i) => ({
        productId: `${String(i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        qty: MAX_QTY,
      })),
    )
    // Browsers keep ~4096 bytes per cookie, including the name and attributes.
    expect((await signCart(full, SECRET)).length).toBeLessThan(3600)
  })
})

/**
 * The cookie is attacker-controlled input on every request. None of these can put a
 * price in front of a shopper — the resolver ignores everything but ids and quantities —
 * but each must be refused before it reaches a query.
 */
describe('a cookie someone has tampered with', () => {
  it('refuses a changed payload', async () => {
    const [payload, sig] = (await signCart(cart(), SECRET)).split('.')
    const forged = Buffer.from(Buffer.from(payload!, 'base64url').toString().replace('2', '9')).toString('base64url')
    expect(await readCart(`${forged}.${sig}`, SECRET, SITE, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('refuses one signed with a different secret', async () => {
    expect(await readCart(await signCart(cart(), 'another-secret'), SECRET, SITE, NOW)).toMatchObject({
      reason: 'bad-signature',
    })
  })

  it('refuses a cookie with no signature', async () => {
    const [payload] = (await signCart(cart(), SECRET)).split('.')
    expect(await readCart(payload, SECRET, SITE, NOW)).toMatchObject({ reason: 'malformed' })
  })

  it('refuses garbage without throwing', async () => {
    for (const junk of ['', '.', '...', 'a.b.c', 'not-base64!.x', '%%%.%%%', 'x'.repeat(6000)])
      expect((await readCart(junk, SECRET, SITE, NOW)).ok).toBe(false)
  })

  // Every tenant shares a parent domain. A cart must never cross from one to another.
  it('refuses a cart minted for another site', async () => {
    const theirs = await signCart({ ...cart(), siteId: OTHER_SITE }, SECRET)
    expect(await readCart(theirs, SECRET, SITE, NOW)).toEqual({ ok: false, reason: 'wrong-site' })
  })

  it('expires a stale cart', async () => {
    const old = await signCart(cart(), SECRET)
    expect(await readCart(old, SECRET, SITE, NOW + MAX_AGE_SECONDS + 1)).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('normalising what goes in', () => {
  it('merges duplicate lines rather than keeping two', () => {
    expect(normaliseCart(cart([{ productId: P1, qty: 2 }, { productId: P1, qty: 3 }])).lines).toEqual([
      { productId: P1, qty: 5 },
    ])
  })

  it('caps quantities', () => {
    expect(normaliseCart(cart([{ productId: P1, qty: 5000 }])).lines[0]!.qty).toBe(MAX_QTY)
  })

  it('drops zero, negative and fractional quantities', () => {
    const lines = [
      { productId: P1, qty: 0 },
      { productId: P2, qty: -3 },
      { productId: P1, qty: 1.5 },
    ]
    expect(normaliseCart(cart(lines)).lines).toEqual([])
  })

  it('drops anything that is not a product id', () => {
    expect(normaliseCart(cart([{ productId: "'; DROP TABLE products;--", qty: 1 }])).lines).toEqual([])
  })

  it('caps the number of lines', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      productId: `${String(i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      qty: 1,
    }))
    expect(normaliseCart(cart(many)).lines).toHaveLength(MAX_LINES)
  })

  it('an empty cart is a valid cart', async () => {
    const r = await readCart(await signCart(emptyCart(SITE, NOW), SECRET), SECRET, SITE, NOW)
    expect(r).toEqual({ ok: true, cart: { siteId: SITE, issuedAt: NOW, lines: [] } })
  })
})

describe('the cookie itself', () => {
  // __Host- is what stops one tenant's page planting a cart cookie on the shared parent
  // domain that every other tenant's site would receive.
  it('uses the __Host- prefix in production, which forbids a Domain attribute', () => {
    const c = cartCookie(true)
    expect(c.name.startsWith('__Host-')).toBe(true)
    expect(c.attributes).toMatchObject({ secure: true, path: '/', httpOnly: true })
    expect('domain' in c.attributes).toBe(false)
  })

  it('drops the prefix over plain http in development, where it cannot be satisfied', () => {
    expect(cartCookie(false).name.startsWith('__Host-')).toBe(false)
  })
})
