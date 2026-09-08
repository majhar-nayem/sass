import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rawPrisma } from '../client.js'
import { withOrgContext, InvalidOrgIdError } from '../with-org-context.js'

/**
 * F-04 / F-10 — tenant isolation.
 *
 * The premise of the whole product is that one business cannot see another's leads,
 * orders or site content. This asserts it at the database layer, below any application
 * code that might forget a filter.
 */

const orgA = randomUUID()
const orgB = randomUUID()
const siteA = randomUUID()
const siteB = randomUUID()

beforeAll(async () => {
  for (const [org, site, slug] of [
    [orgA, siteA, `iso-a-${org_suffix(orgA)}`],
    [orgB, siteB, `iso-b-${org_suffix(orgB)}`],
  ] as const) {
    await rawPrisma.organizations.create({
      data: { id: org, name: `Org ${slug}`, slug, state: 'SA' },
    })
    await rawPrisma.sites.create({
      data: { id: site, org_id: org, name: `Site ${slug}`, slug, industry: 'plumber' },
    })
    await rawPrisma.form_submissions.create({
      data: {
        site_id: site,
        payload: { message: `secret lead for ${slug}` },
        email: `lead@${slug}.test`,
        name: 'A Customer',
      },
    })
  }
})

afterAll(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  await rawPrisma.$disconnect()
})

function org_suffix(id: string) {
  return id.slice(0, 8)
}

describe('withOrgContext', () => {
  it('sees its own site', async () => {
    const sites = await withOrgContext(orgA, (tx) => tx.sites.findMany())
    expect(sites.map((s) => s.id)).toEqual([siteA])
  })

  it('cannot read another org’s sites, even asking for them by id', async () => {
    const found = await withOrgContext(orgA, (tx) =>
      tx.sites.findUnique({ where: { id: siteB } }),
    )
    expect(found).toBeNull()
  })

  it('cannot read another org’s leads with an unfiltered query', async () => {
    // The query has no org filter at all. RLS is what makes this safe.
    const leads = await withOrgContext(orgA, (tx) => tx.form_submissions.findMany())
    expect(leads).toHaveLength(1)
    expect(leads[0]?.site_id).toBe(siteA)
  })

  it('cannot read another org itself', async () => {
    const orgs = await withOrgContext(orgA, (tx) => tx.organizations.findMany())
    expect(orgs.map((o) => o.id)).toEqual([orgA])
  })

  it('cannot UPDATE another org’s site', async () => {
    const n = await withOrgContext(orgA, (tx) =>
      tx.sites.updateMany({ where: { id: siteB }, data: { name: 'pwned' } }),
    )
    expect(n.count).toBe(0)
    const untouched = await rawPrisma.sites.findUnique({ where: { id: siteB } })
    expect(untouched?.name).not.toBe('pwned')
  })

  it('cannot DELETE another org’s site', async () => {
    const n = await withOrgContext(orgA, (tx) => tx.sites.deleteMany({ where: { id: siteB } }))
    expect(n.count).toBe(0)
    expect(await rawPrisma.sites.findUnique({ where: { id: siteB } })).not.toBeNull()
  })

  it('cannot INSERT a row into another org (WITH CHECK)', async () => {
    await expect(
      withOrgContext(orgA, (tx) =>
        tx.sites.create({
          data: { org_id: orgB, name: 'smuggled', slug: `smuggled-${Date.now()}` },
        }),
      ),
    ).rejects.toThrow()
  })

  it('rejects a non-UUID org id before it reaches SQL', async () => {
    await expect(
      withOrgContext("' OR '1'='1", async () => 'unreachable'),
    ).rejects.toBeInstanceOf(InvalidOrgIdError)
  })

  it('does not leak org context to the next transaction (SET LOCAL is scoped)', async () => {
    await withOrgContext(orgA, (tx) => tx.sites.findMany())
    const b = await withOrgContext(orgB, (tx) => tx.sites.findMany())
    expect(b.map((s) => s.id)).toEqual([siteB])
  })
})

describe('renderer path (owner role)', () => {
  it('resolves any tenant without org context, because it has none yet', async () => {
    const all = await rawPrisma.sites.findMany({ where: { id: { in: [siteA, siteB] } } })
    expect(all).toHaveLength(2)
  })
})
