import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * P-06 -- signed preview tokens.
 *
 * The editor and the renderer are on different registrable domains, deliberately
 * (docs/02-ARCHITECTURE.md §1), so the renderer cannot read the dashboard's session
 * cookie — which is the entire point of that split and not something to work around.
 *
 * A short-lived HMAC in the URL is the right shape here: stateless, no shared session
 * store, no new cookie on the tenant domain, and an expiry so a preview link pasted into
 * a chat is worthless within the hour.
 */
const TTL_SECONDS = 60 * 60

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET
  if (!s) throw new Error('BETTER_AUTH_SECRET is required to sign preview tokens.')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function createPreviewToken(siteId: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + TTL_SECONDS
  const payload = `${siteId}.${expires}`
  return `${payload}.${sign(payload)}`
}

export function verifyPreviewToken(token: string, now = Date.now()): { siteId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [siteId, expiresRaw, mac] = parts as [string, string, string]

  const expires = Number(expiresRaw)
  if (!Number.isFinite(expires) || expires * 1000 < now) return null

  const expected = sign(`${siteId}.${expiresRaw}`)
  // Constant-time: a fast-path string compare leaks the signature a byte at a time.
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return { siteId }
}
