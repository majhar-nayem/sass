import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { rawPrisma } from '@awning/db'
import { disconnectTenantCache, invalidateTenant, resolveTenant } from '../resolve.js'

/**
 * R-01 -- tenant resolution against real Postgres and Redis.
 *
 * Mocking either would test the mock. The whole point of this function is that a
 * cached answer, a database answer and a stale answer agree, and only real backends
 * can show that.
 */
const ROOT = 'awningsites.test'
const orgId = randomUUID()
const siteId = randomUUID()
const sub = `resolve-${siteId.slice(0, 8)}`
const host = `${sub}.${ROOT}`
const apex = `${sub}-custom.test`
const www = `www.${sub}-custom.test`

let redis: Redis

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  await rawPrisma.organizations.create({
    data: { id: orgId, name: 'Resolve Test', slug: sub, state: 'SA' },
  })
  await rawPrisma.sites.create({
    data: { id: siteId, org_id: orgId, name: 'Resolve Test', slug: sub, status: 'published' },
  })
  await rawPrisma.site_domains.createMany({
    data: [
      { site_id: siteId, hostname: host, kind: 'subdomain', status: 'active', is_primary: false },
      { site_id: siteId, hostname: www, kind: 'custom', status: 'active', is_primary: true },
      {
        site_id: siteId,
        hostname: apex,
        kind: 'custom',
        status: 'active',
        is_primary: false,
        redirect_to_primary: true,
      },
    ],
  })
})

afterAll(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  await invalidateTenant(host, apex, www, `nope.${ROOT}`)
  await redis.quit()
  await disconnectTenantCache()
  await rawPrisma.$disconnect()
})

describe('resolveTenant', () => {
  it('resolves a live subdomain to its site', async () => {
    await invalidateTenant(host)
    const t = await resolveTenant(host, { sitesRootDomain: ROOT })
    expect(t).toMatchObject({ siteId, orgId, status: 'published' })
  })

  it('normalises before looking up, so case and port still resolve', async () => {
    await invalidateTenant(host)
    const t = await resolveTenant(`${sub.toUpperCase()}.${ROOT.toUpperCase()}:443`, {
      sitesRootDomain: ROOT,
    })
    expect(t?.siteId).toBe(siteId)
  })

  it('caches the answer in Redis', async () => {
    await invalidateTenant(host)
    await resolveTenant(host, { sitesRootDomain: ROOT })
    const cached = await redis.get(`tenant:v1:${host}`)
    expect(cached).toBeTruthy()
    expect(JSON.parse(cached!).siteId).toBe(siteId)
  })

  it('serves the second call from cache, not the database', async () => {
    await invalidateTenant(host)
    await resolveTenant(host, { sitesRootDomain: ROOT })
    // Delete the row underneath. A cached read must still answer.
    const row = await rawPrisma.site_domains.findFirst({ where: { hostname: host } })
    await rawPrisma.site_domains.update({ where: { id: row!.id }, data: { status: 'failed' } })
    const t = await resolveTenant(host, { sitesRootDomain: ROOT })
    expect(t?.siteId).toBe(siteId)
    await rawPrisma.site_domains.update({ where: { id: row!.id }, data: { status: 'active' } })
    await invalidateTenant(host)
  })

  it('invalidateTenant makes the next read hit the database again', async () => {
    await resolveTenant(host, { sitesRootDomain: ROOT })
    await invalidateTenant(host)
    expect(await redis.get(`tenant:v1:${host}`)).toBeNull()
  })

  it('returns null for an unknown host and negatively caches it', async () => {
    const unknown = `nope.${ROOT}`
    await invalidateTenant(unknown)
    expect(await resolveTenant(unknown, { sitesRootDomain: ROOT })).toBeNull()
    // A scanner hitting a thousand unknown hosts must not cost a thousand queries.
    expect(await redis.get(`tenant:v1:${unknown}`)).toBe(' ')
    expect(await resolveTenant(unknown, { sitesRootDomain: ROOT })).toBeNull()
  })

  it('ignores a hostname that is not active yet', async () => {
    const pending = `pending-${sub}.${ROOT}`
    await rawPrisma.site_domains.create({
      data: { site_id: siteId, hostname: pending, kind: 'custom', status: 'verifying' },
    })
    await invalidateTenant(pending)
    expect(await resolveTenant(pending, { sitesRootDomain: ROOT })).toBeNull()
  })

  it('reports the canonical host for a non-primary domain, so it can 301', async () => {
    await invalidateTenant(apex)
    const t = await resolveTenant(apex, { sitesRootDomain: ROOT })
    expect(t?.redirectTo).toBe(www)
  })

  it('does not set redirectTo on the primary host', async () => {
    await invalidateTenant(www)
    const t = await resolveTenant(www, { sitesRootDomain: ROOT })
    expect(t?.redirectTo).toBeUndefined()
  })

  it.each(['', 'localhost', ROOT, 'awning-render.fly.dev', 'has space.com'])(
    'returns null without querying for %s',
    async (h) => {
      expect(await resolveTenant(h, { sitesRootDomain: ROOT })).toBeNull()
    },
  )

  it('carries cacheEpoch, which the CDN cache key depends on', async () => {
    await invalidateTenant(host)
    const before = await resolveTenant(host, { sitesRootDomain: ROOT })
    await rawPrisma.sites.update({
      where: { id: siteId },
      data: { cache_epoch: { increment: 1 } },
    })
    await invalidateTenant(host)
    const after = await resolveTenant(host, { sitesRootDomain: ROOT })
    expect(after!.cacheEpoch).toBe(before!.cacheEpoch + 1)
  })
})
