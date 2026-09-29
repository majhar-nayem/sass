/**
 * M-05 -- the cart, in a signed cookie.
 *
 * Be precise about what the signature buys, because it is easy to believe it buys more.
 * It does NOT make the cart trustworthy. The cookie carries only product ids and
 * quantities — never a price, a name or a total — and every read re-resolves those ids
 * against the database, for this site, at today's prices. That is where the integrity
 * comes from. A forged cookie can at most ask for products that exist, on this site, in
 * quantities the resolver caps anyway.
 *
 * What the signature does buy: garbage is rejected before it reaches a query, a cookie
 * minted for one site is refused on another, and an old cart expires on our terms.
 *
 * Web Crypto rather than node:crypto — `subtle.verify` does the constant-time
 * comparison itself, and this module stays importable from any runtime. (A node:crypto
 * import reachable from an edge bundle took down every dashboard route under `next dev`
 * in F-11; that lesson is cheap to keep.)
 */

export interface CartLine {
  productId: string
  qty: number
}

export interface Cart {
  siteId: string
  lines: CartLine[]
  /** Seconds since epoch. */
  issuedAt: number
}

/** 50 lines × ~45 bytes stays well under the 4 KB a browser will keep. */
export const MAX_LINES = 50
export const MAX_QTY = 99
/** A cart older than this is a stale cart. */
export const MAX_AGE_SECONDS = 30 * 24 * 3600

const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Typed as backed by a plain ArrayBuffer: Web Crypto refuses views over a
// SharedArrayBuffer, and TypeScript 5.7+ tells the two apart.
function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function key(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Clamps a cart to what the rest of the system will accept. */
export function normaliseCart(cart: Cart): Cart {
  const merged = new Map<string, number>()
  for (const l of cart.lines) {
    if (!UUID.test(l.productId) || !Number.isInteger(l.qty) || l.qty < 1) continue
    merged.set(l.productId, Math.min(MAX_QTY, (merged.get(l.productId) ?? 0) + l.qty))
  }
  return {
    siteId: cart.siteId,
    issuedAt: cart.issuedAt,
    lines: [...merged].slice(0, MAX_LINES).map(([productId, qty]) => ({ productId, qty })),
  }
}

export async function signCart(cart: Cart, secret: string): Promise<string> {
  const c = normaliseCart(cart)
  // Compact on purpose: this is sent with every request to the tenant's site.
  const payload = toB64url(
    enc.encode(JSON.stringify({ v: 1, s: c.siteId, t: c.issuedAt, i: c.lines.map((l) => [l.productId, l.qty]) })),
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)))
  return `${payload}.${toB64url(sig)}`
}

export type CartReadFailure = 'missing' | 'malformed' | 'bad-signature' | 'wrong-site' | 'expired'

/**
 * Reads a cart cookie, or says why it could not.
 *
 * Every failure means the same thing to a visitor — an empty cart — but they mean very
 * different things to us: `bad-signature` in volume is someone probing, `wrong-site` is
 * a cookie crossing tenants, and neither should look like a shopper who never added
 * anything.
 */
export async function readCart(
  cookie: string | undefined | null,
  secret: string,
  expectSiteId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ ok: true; cart: Cart } | { ok: false; reason: CartReadFailure }> {
  if (!cookie) return { ok: false, reason: 'missing' }
  // A cookie is capped near 4 KB; anything much bigger is not one of ours.
  if (cookie.length > 5000) return { ok: false, reason: 'malformed' }

  const dot = cookie.indexOf('.')
  if (dot <= 0 || dot !== cookie.lastIndexOf('.')) return { ok: false, reason: 'malformed' }
  const payload = cookie.slice(0, dot)
  const sig = fromB64url(cookie.slice(dot + 1))
  if (!sig) return { ok: false, reason: 'malformed' }

  // Verify BEFORE parsing: nothing in an unauthenticated payload is worth reading.
  const valid = await crypto.subtle.verify('HMAC', await key(secret), sig, enc.encode(payload))
  if (!valid) return { ok: false, reason: 'bad-signature' }

  const bytes = fromB64url(payload)
  if (!bytes) return { ok: false, reason: 'malformed' }
  let raw: { v?: number; s?: string; t?: number; i?: unknown }
  try {
    raw = JSON.parse(dec.decode(bytes))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (raw.v !== 1 || typeof raw.s !== 'string' || typeof raw.t !== 'number' || !Array.isArray(raw.i))
    return { ok: false, reason: 'malformed' }

  // Defence in depth: the cookie is host-only already, but a custom domain and its
  // subdomain point at the same site, and a cart must never cross from one tenant to
  // another under any routing change.
  if (raw.s !== expectSiteId) return { ok: false, reason: 'wrong-site' }
  if (nowSeconds - raw.t > MAX_AGE_SECONDS) return { ok: false, reason: 'expired' }

  const lines: CartLine[] = []
  for (const entry of raw.i) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'number') continue
    lines.push({ productId: entry[0], qty: entry[1] })
  }
  return { ok: true, cart: normaliseCart({ siteId: raw.s, issuedAt: raw.t, lines }) }
}

export function emptyCart(siteId: string, nowSeconds = Math.floor(Date.now() / 1000)): Cart {
  return { siteId, issuedAt: nowSeconds, lines: [] }
}

/**
 * The cookie's name and attributes.
 *
 * `__Host-` is the load-bearing part. Every tenant shares awningsites.com, and without
 * the prefix one tenant's page could set a cart cookie scoped to the PARENT domain that
 * every other tenant's site would then receive ("cookie tossing"). A `__Host-` cookie
 * must be Secure, Path=/ and carry no Domain, so the browser refuses to let a sibling
 * subdomain plant one. The Public Suffix List entry will block that too, eventually;
 * this works today.
 *
 * Over plain http in development the prefix cannot be satisfied, so the name drops it.
 */
export function cartCookie(production: boolean) {
  return {
    name: production ? '__Host-awning_cart' : 'awning_cart',
    attributes: {
      httpOnly: true,
      secure: production,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: MAX_AGE_SECONDS,
    },
  }
}
