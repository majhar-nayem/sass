/**
 * Subdomain allocation. A subdomain is permanent in practice — it is printed on
 * business cards and indexed by Google — so the rules are strict up front.
 */

/**
 * Names that must never become a tenant subdomain: they either collide with platform
 * infrastructure or let a tenant impersonate us. `support.awningsites.com` in someone
 * else's hands is a phishing page with our certificate on it.
 */
export const RESERVED_SUBDOMAINS = new Set([
  'www','admin','api','app','mail','smtp','imap','pop','ftp','ns','ns1','ns2','mx','dns',
  'cdn','assets','static','img','images','media','files','uploads','download','downloads',
  'test','staging','stage','dev','preview','demo','sandbox','local','localhost',
  'blog','help','support','docs','status','about','legal','privacy','terms','security',
  'shop','store','account','accounts','billing','pay','payment','checkout','order','orders',
  'login','logout','signup','signin','register','auth','oauth','sso','password','reset',
  'cname','edge','origin','proxy','gateway','router','health','healthz','metrics','monitor',
  'awning','awningsites','root','system','internal','private','public','null','undefined',
])

export type SubdomainCheck = { ok: true } | { ok: false; reason: string }

export function validateSubdomain(label: string): SubdomainCheck {
  if (label !== label.toLowerCase()) return { ok: false, reason: 'Must be lowercase.' }
  if (label.length < 3) return { ok: false, reason: 'Must be at least 3 characters.' }
  if (label.length > 63) return { ok: false, reason: 'Must be 63 characters or fewer.' }
  if (!/^[a-z0-9-]+$/.test(label))
    return { ok: false, reason: 'Letters, numbers and hyphens only.' }
  if (label.startsWith('-') || label.endsWith('-'))
    return { ok: false, reason: 'Cannot start or end with a hyphen.' }
  if (label.includes('--') && !label.startsWith('xn--'))
    return { ok: false, reason: 'Cannot contain two hyphens in a row.' }
  // A punycode prefix lets a name render as visually identical to another business's.
  if (label.startsWith('xn--'))
    return { ok: false, reason: 'Internationalised names are not supported yet.' }
  if (RESERVED_SUBDOMAINS.has(label))
    return { ok: false, reason: 'That name is reserved. Try adding your suburb or trade.' }
  return { ok: true }
}

export function slugifyBusinessName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents left by NFKD
    .toLowerCase()
    .replace(/['’`]/g, '')                // Dave's → daves
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
    .replace(/-$/, '')
  return base.length >= 3 ? base : `site-${base}`.slice(0, 50).replace(/-$/, '')
}

/**
 * Turn a business name into a free, valid subdomain. `isTaken` is injected so this
 * stays pure and unit-testable — the caller supplies the database check.
 */
export async function allocateSubdomain(
  businessName: string,
  isTaken: (label: string) => Promise<boolean>,
  maxAttempts = 50,
): Promise<string> {
  const base = slugifyBusinessName(businessName)
  const seed = validateSubdomain(base).ok ? base : `${base}-site`.slice(0, 63)

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = i === 0 ? seed : `${seed}-${i + 1}`.slice(0, 63).replace(/-$/, '')
    if (!validateSubdomain(candidate).ok) continue
    if (!(await isTaken(candidate))) return candidate
  }
  // Deterministic names exhausted — fall back to something unmistakably unique rather
  // than throwing, because this runs mid-signup and a failure here loses the customer.
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${seed}-${suffix}`.slice(0, 63)
}
