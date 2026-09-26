import Redis from 'ioredis'
import { withoutOrgContext } from '@awning/db'
import { isInfrastructureHost, normaliseHost } from './hostname.js'

export interface TenantRef {
  siteId: string
  orgId: string
  /** Bumped on publish; part of the CDN cache key so old objects retire instantly. */
  cacheEpoch: number
  status: string
  /** Set when this hostname is not the canonical one and should 301. */
  redirectTo?: string
}

const TTL_SECONDS = 300
const NEGATIVE_TTL_SECONDS = 30

let redis: Redis | null = null

function client(): Redis | null {
  if (redis) return redis
  const url = process.env.REDIS_URL
  if (!url) return null // resolve straight from Postgres; correct, just slower
  redis = new Redis(url, { maxRetriesPerRequest: 2 })
  redis.on('error', () => {}) // a cache outage must not take every tenant site down
  return redis
}

const key = (h: string) => `tenant:v1:${h}`

/**
 * Is the cache reachable? Used by the deep health check.
 *
 * `null` means no cache is configured, which is a valid deployment — resolution falls
 * back to Postgres. That is reported as "off", not as a failure, so a health check does
 * not go red for a choice someone made deliberately.
 */
export async function pingCache(): Promise<'ok' | 'off' | 'unreachable'> {
  const c = client()
  if (!c) return 'off'
  try {
    await c.ping()
    return 'ok'
  } catch {
    return 'unreachable'
  }
}

/**
 * Contract #7 -- the hottest path in the system. Every uncached tenant request runs this.
 *
 * Redis (~1 ms) then Postgres (~8 ms), with misses cached briefly too: an unknown host
 * is usually a scanner or a half-configured domain, and without a negative cache each
 * one costs a database round trip.
 */
export async function resolveTenant(
  rawHost: string | null | undefined,
  opts: { sitesRootDomain?: string } = {},
): Promise<TenantRef | null> {
  const host = normaliseHost(rawHost)
  if (!host) return null

  const root = opts.sitesRootDomain ?? process.env.SITES_ROOT_DOMAIN ?? 'awningsites.com'
  if (isInfrastructureHost(host, root)) return null

  const r = client()
  if (r) {
    try {
      const hit = await r.get(key(host))
      if (hit) return hit === ' ' ? null : (JSON.parse(hit) as TenantRef)
    } catch {
      // fall through to Postgres
    }
  }

  const row = await withoutOrgContext('tenant-resolution', async (db) =>
    db.site_domains.findFirst({
      where: { hostname: host, status: 'active' },
      select: {
        is_primary: true,
        redirect_to_primary: true,
        sites: { select: { id: true, org_id: true, cache_epoch: true, status: true } },
      },
    }),
  )

  let ref: TenantRef | null = null
  if (row?.sites) {
    ref = {
      siteId: row.sites.id,
      orgId: row.sites.org_id,
      cacheEpoch: row.sites.cache_epoch,
      status: row.sites.status,
    }
    if (row.redirect_to_primary && !row.is_primary) {
      const primary = await withoutOrgContext('tenant-resolution', async (db) =>
        db.site_domains.findFirst({
          where: { site_id: row.sites.id, is_primary: true, status: 'active' },
          select: { hostname: true },
        }),
      )
      if (primary) ref.redirectTo = primary.hostname
    }
  }

  if (r) {
    try {
      await r.set(
        key(host),
        ref ? JSON.stringify(ref) : ' ',
        'EX',
        ref ? TTL_SECONDS : NEGATIVE_TTL_SECONDS,
      )
    } catch {
      // cache write is best effort
    }
  }
  return ref
}

/**
 * Called on publish, domain attach/detach and suspension. Forgetting this is the bug
 * where a customer publishes and sees nothing change for five minutes.
 */
export async function invalidateTenant(...hosts: string[]): Promise<void> {
  const r = client()
  if (!r) return
  const keys = hosts
    .map(normaliseHost)
    .filter((h): h is string => !!h)
    .map(key)
  if (keys.length) await r.del(...keys)
}

export async function disconnectTenantCache(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = null
  }
}
