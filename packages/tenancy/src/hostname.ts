/**
 * Hostname handling for the renderer's hot path. Every tenant request starts here, so
 * these functions are pure and cheap — no I/O, no allocation beyond the string.
 */

/**
 * Normalise a Host header into a lookup key.
 *
 * Browsers, proxies and health checkers all send subtly different forms of the same
 * host: mixed case, an explicit port, a fully-qualified trailing dot. Each would miss
 * the unique index on `site_domains.hostname` and serve a 404 for a live site.
 */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  let h = raw.trim().toLowerCase()

  // IPv6 literal: [::1]:3000. Kept in bracketed form rather than rejected, so
  // isInfrastructureHost can classify it instead of every such request looking like
  // a malformed host.
  if (h.startsWith('[')) {
    const close = h.indexOf(']')
    if (close === -1) return null
    const literal = h.slice(0, close + 1)
    return /^\[[0-9a-f:.]+\]$/.test(literal) ? literal : null
  } else {
    const colon = h.indexOf(':')
    if (colon !== -1) h = h.slice(0, colon)
  }

  if (h.endsWith('.')) h = h.slice(0, -1) // fully-qualified form
  if (h.length === 0 || h.length > 253) return null
  if (!/^[a-z0-9.-]+$/.test(h)) return null // no unicode: punycode or nothing
  if (h.startsWith('.') || h.includes('..')) return null

  return h
}

/**
 * Hosts that reach the renderer but are never a tenant: platform infrastructure,
 * health checks and the bare apex. Treating one of these as a tenant lookup wastes a
 * database round trip on every health check, and worse, a site slugged `health` would
 * shadow it.
 */
export function isInfrastructureHost(host: string, sitesRootDomain: string): boolean {
  if (host === sitesRootDomain) return true
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('[')) return true
  if (host.endsWith('.fly.dev') || host.endsWith('.internal')) return true
  return false
}

/** The label in `daves-plumbing.awningsites.com`, or null if this is a custom domain. */
export function subdomainLabelOf(host: string, sitesRootDomain: string): string | null {
  const suffix = '.' + sitesRootDomain
  if (!host.endsWith(suffix)) return null
  const label = host.slice(0, -suffix.length)
  // Only one level deep: Cloudflare's Universal SSL covers *.root, not *.*.root, so a
  // deeper name would resolve but present a certificate error.
  if (label.includes('.')) return null
  return label || null
}
