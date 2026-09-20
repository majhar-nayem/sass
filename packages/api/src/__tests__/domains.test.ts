import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rawPrisma, type PrismaTx } from '@awning/db'
import { attachDomain, detachDomain, diagnose, DomainRejected, statusFrom, validateCustomHostname } from '../domains.js'

/**
 * O-01 -- custom domains.
 *
 * The state machine and the messages are tested without Cloudflare: with no credentials
 * a domain is registered as `pending` and the sweep advances it later, which is exactly
 * the behaviour we want when Cloudflare is unreachable in production too.
 */
const orgId = randomUUID()
const siteId = randomUUID()
const otherSiteId = randomUUID()
const db = () => rawPrisma as unknown as PrismaTx

beforeEach(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  const slug = `dom-${orgId.slice(0, 8)}`
  await rawPrisma.organizations.create({ data: { id: orgId, name: slug, slug } })
  await rawPrisma.sites.create({ data: { id: siteId, org_id: orgId, name: slug, slug } })
  await rawPrisma.sites.create({ data: { id: otherSiteId, org_id: orgId, name: 'other', slug: `${slug}-2` } })
})

afterAll(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  await rawPrisma.$disconnect()
})

describe('validateCustomHostname', () => {
  it.each([
    ['daveplumbing.com.au', 'daveplumbing.com.au'],
    ['WWW.DavePlumbing.com.au', 'www.daveplumbing.com.au'],
    ['  daveplumbing.com.au.  ', 'daveplumbing.com.au'],
    ['daveplumbing.com.au:443', 'daveplumbing.com.au'],
  ])('accepts and normalises %s', (input, expected) => {
    expect(validateCustomHostname(input)).toBe(expected)
  })

  it.each([
    ['', 'empty'],
    ['notadomain', 'no dot'],
    ['192.168.0.1', 'an IP'],
    ['has space.com', 'a space'],
  ])('rejects %s (%s)', (input) => {
    expect(() => validateCustomHostname(input)).toThrow(DomainRejected)
  })

  /**
   * Attaching a subdomain of our own wildcard as a "custom" hostname would fight the
   * subdomain router and leave a site reachable two ways with different certificates.
   */
  it('rejects our own wildcard domain', () => {
    const root = process.env.SITES_ROOT_DOMAIN ?? 'awningsites.com'
    expect(() => validateCustomHostname(`dave.${root}`)).toThrow(/already yours/i)
  })

  it('explains the problem rather than just failing', () => {
    try {
      validateCustomHostname('192.168.0.1')
    } catch (e) {
      expect((e as DomainRejected).message).toMatch(/domain name, not an IP/i)
    }
  })
})

describe('attachDomain', () => {
  it('registers as pending and hands back copy-pasteable instructions', async () => {
    const r = await attachDomain(db(), siteId, 'daveplumbing.com.au', { primary: true })
    expect(r.status).toBe('pending')
    expect(r.instructions).toMatch(/CNAME/)
    expect(r.instructions).toContain(r.cnameTarget)

    const row = await rawPrisma.site_domains.findFirst({ where: { hostname: 'daveplumbing.com.au' } })
    expect(row?.site_id).toBe(siteId)
    expect(row?.kind).toBe('custom')
    // Never 'active' on attach: a hostname goes live only once ownership is confirmed,
    // which is what stops someone claiming a domain they do not control.
    expect(row?.status).not.toBe('active')
  })

  it('supports www and apex as two rows on one site', async () => {
    await attachDomain(db(), siteId, 'www.daveplumbing.com.au', { primary: true })
    await attachDomain(db(), siteId, 'daveplumbing.com.au')
    const rows = await rawPrisma.site_domains.findMany({ where: { site_id: siteId, kind: 'custom' } })
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.is_primary)).toHaveLength(1)
  })

  /** Otherwise one tenant could hijack another's traffic by claiming their hostname. */
  it('refuses a hostname already attached to a different site', async () => {
    await attachDomain(db(), siteId, 'daveplumbing.com.au')
    await expect(attachDomain(db(), otherSiteId, 'daveplumbing.com.au')).rejects.toThrow(/another site/i)
  })

  it('is idempotent for the same site', async () => {
    await attachDomain(db(), siteId, 'daveplumbing.com.au')
    await attachDomain(db(), siteId, 'daveplumbing.com.au')
    expect(await rawPrisma.site_domains.count({ where: { hostname: 'daveplumbing.com.au' } })).toBe(1)
  })
})

describe('detachDomain', () => {
  it('detaches a custom domain', async () => {
    await attachDomain(db(), siteId, 'daveplumbing.com.au')
    const row = await rawPrisma.site_domains.findFirst({ where: { hostname: 'daveplumbing.com.au' } })
    await detachDomain(db(), row!.id)
    const after = await rawPrisma.site_domains.findUnique({ where: { id: row!.id } })
    expect(after?.status).toBe('detached')
  })

  /** The subdomain is the site's permanent address; removing it orphans the tenant. */
  it('refuses to remove the platform subdomain', async () => {
    const sub = await rawPrisma.site_domains.create({
      data: { site_id: siteId, hostname: `x-${siteId.slice(0, 8)}.awningsites.test`, kind: 'subdomain', status: 'active' },
    })
    await expect(detachDomain(db(), sub.id)).rejects.toThrow(/cannot be removed/i)
  })
})

/**
 * The messages are the feature. "Your registrar's parking page is still there" saves a
 * twenty-minute phone call; "verification_errors: pending_validation" saves nothing.
 */
describe('diagnostics', () => {
  it.each([
    [['no valid A or CNAME record found'], 'dns_missing', /24 hours/],
    [['record points to parking.godaddy.com'], 'dns_parked', /parking page/i],
    [['CAA record prevents issuance'], 'caa_blocked', /letsencrypt/],
    [['hostname is proxied by another Cloudflare account'], 'cf_proxied', /grey cloud/i],
    [['conflicting record: MX exists on apex'], 'apex_conflict', /point www at us/i],
    [['domain has expired'], 'domain_expired', /renew it/i],
    [['rate limit exceeded for certificate issuance'], 'rate_limited', /within an hour/i],
  ])('%s -> %s', (errors, code, matcher) => {
    const d = diagnose(errors)
    expect(d.code).toBe(code)
    expect(d.message).toMatch(matcher)
  })

  it('never shows raw Cloudflare text to the owner', () => {
    const d = diagnose(['internal_error_5023: backend unavailable'])
    expect(d.code).toBe('unknown')
    expect(d.message).not.toMatch(/5023|backend/)
  })

  it('has a sensible message when there is no error at all', () => {
    expect(diagnose([]).code).toBe('waiting')
  })
})

describe('status mapping', () => {
  it.each([
    [{ status: 'active', sslStatus: 'active' }, 'active'],
    [{ status: 'active', sslStatus: 'pending_validation' }, 'ssl_pending'],
    [{ status: 'pending', sslStatus: 'initializing' }, 'verifying'],
    [{ status: 'blocked', sslStatus: 'none' }, 'failed'],
    [{ status: 'moved', sslStatus: 'none' }, 'failed'],
  ])('%o -> %s', (cf, expected) => {
    expect(statusFrom(cf)).toBe(expected)
  })
})
