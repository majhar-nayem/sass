/**
 * O-01 -- Cloudflare for SaaS custom hostnames.
 *
 * The tenant points DNS at us, Cloudflare issues and renews the certificate, and we
 * never touch ACME. The alternative — running our own certificate automation for
 * hundreds of customer domains — is a whole job nobody is available to do.
 */
const API = 'https://api.cloudflare.com/client/v4'

export interface CfVerification {
  /** TXT record the owner adds to prove they control the domain, before DNS is moved. */
  txtName?: string
  txtValue?: string
  /** What the CNAME should point at. */
  cnameTarget: string
}

export interface CfHostname {
  id: string
  hostname: string
  /** Cloudflare's own vocabulary: pending, active, blocked, moved, deleted. */
  status: string
  sslStatus: string
  verification: CfVerification
  /** Cloudflare's diagnostic text, which is for us, not for the owner. */
  errors: string[]
}

export function cloudflareConfigured(): boolean {
  return Boolean(process.env.CF_API_TOKEN && process.env.CF_ZONE_ID_SITES)
}

export function cnameTarget(): string {
  return process.env.CF_CNAME_TARGET ?? `cname.${process.env.SITES_ROOT_DOMAIN ?? 'awningsites.com'}`
}

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.CF_API_TOKEN
  const zone = process.env.CF_ZONE_ID_SITES
  if (!token || !zone) throw new Error('Cloudflare is not configured.')

  const res = await fetch(`${API}/zones/${zone}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = (await res.json()) as {
    success: boolean
    result?: T
    errors?: Array<{ code: number; message: string }>
  }
  if (!body.success)
    throw new Error(body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${res.status}`)
  return body.result as T
}

interface CfRaw {
  id: string
  hostname: string
  status: string
  ssl?: { status?: string; validation_errors?: Array<{ message: string }> }
  ownership_verification?: { name?: string; value?: string }
  verification_errors?: string[]
}

function shape(raw: CfRaw): CfHostname {
  return {
    id: raw.id,
    hostname: raw.hostname,
    status: raw.status,
    sslStatus: raw.ssl?.status ?? 'unknown',
    verification: {
      ...(raw.ownership_verification?.name ? { txtName: raw.ownership_verification.name } : {}),
      ...(raw.ownership_verification?.value ? { txtValue: raw.ownership_verification.value } : {}),
      cnameTarget: cnameTarget(),
    },
    errors: [
      ...(raw.verification_errors ?? []),
      ...(raw.ssl?.validation_errors ?? []).map((e) => e.message),
    ],
  }
}

export async function createCustomHostname(hostname: string): Promise<CfHostname> {
  const raw = await cf<CfRaw>('/custom_hostnames', {
    method: 'POST',
    body: JSON.stringify({
      hostname,
      // http validation needs the domain already pointed at us; txt lets an owner
      // pre-validate before they cut over, which is the difference between a
      // five-minute switch and a morning of downtime on their existing site.
      ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
    }),
  })
  return shape(raw)
}

export async function getCustomHostname(id: string): Promise<CfHostname> {
  return shape(await cf<CfRaw>(`/custom_hostnames/${id}`))
}

export async function deleteCustomHostname(id: string): Promise<void> {
  await cf(`/custom_hostnames/${id}`, { method: 'DELETE' })
}

/**
 * Purge by URL on publish.
 *
 * Purge-by-tag is Cloudflare Enterprise, and a tenant's page list is under ten URLs, so
 * this is the version that works on the plan we are actually on
 * (docs/02-ARCHITECTURE.md §7).
 */
export async function purgeUrls(urls: string[]): Promise<void> {
  if (!cloudflareConfigured() || urls.length === 0) return
  await cf('/purge_cache', { method: 'POST', body: JSON.stringify({ files: urls.slice(0, 30) }) })
}
