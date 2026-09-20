import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rawPrisma } from '@awning/db'
import { appRouter } from '../root.js'
import { createCallerFactory, type Context } from '../trpc.js'

/**
 * F-10 -- the cross-tenant isolation matrix.
 *
 * The premise of the product is that one business cannot see another's leads, orders or
 * site content. The database-level guarantee is tested in @awning/db; this tests the
 * layer customers actually reach, by signing in as org A and asking every procedure for
 * org B's data by id.
 *
 * The list is GENERATED from the router, not hand-written. A new procedure with no
 * entry in COVERAGE fails the suite -- which is the point. A hand-maintained list would
 * silently stop covering the procedure someone adds at 6pm on a Friday in December.
 */

type Strategy =
  | { kind: 'public' } //  no auth, no tenant data
  | { kind: 'authed' } //  signed in but not org-scoped (signup)
  | { kind: 'isolated'; input: (ids: Ids) => unknown; mutates?: boolean }

interface Ids {
  orgId: string
  siteId: string
  versionId: string
  leadId: string
}

/**
 * Every procedure in the router must appear here. Adding a procedure without deciding
 * how it is isolated is the mistake this catches.
 */
const COVERAGE: Record<string, Strategy> = {
  health: { kind: 'public' },

  'org.create': { kind: 'authed' },
  'org.current': { kind: 'authed' },
  'org.get': { kind: 'isolated', input: () => undefined },
  'org.update': { kind: 'isolated', input: () => ({ name: 'pwned' }), mutates: true },
  'org.members': { kind: 'isolated', input: () => undefined },

  'site.list': { kind: 'isolated', input: () => undefined },
  'site.get': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }) },
  'site.update': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, name: 'pwned' }),
    mutates: true,
  },
  'site.listVersions': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }) },
  'site.publish': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }), mutates: true },
  'site.unpublish': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }), mutates: true },

  'lead.list': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }) },
  'lead.exportCsv': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }), mutates: false },
  'lead.unreadCount': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }) },
  'lead.markRead': { kind: 'isolated', input: (b) => ({ leadId: b.leadId }), mutates: true },
  'lead.archive': { kind: 'isolated', input: (b) => ({ leadId: b.leadId }), mutates: true },

  // The editing surface. ai.chat is listed as isolated rather than skipped on the
  // grounds that it calls a model: asking for another org's site must fail at the draft
  // lookup, BEFORE any model call, and this proves it does — a version that reached the
  // API would both leak and cost money.
  'ai.quota': { kind: 'isolated', input: () => undefined },
  'ai.chat': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, message: 'make the hero smaller' }),
    mutates: true,
  },
  'ai.undo': { kind: 'isolated', input: (b) => ({ siteId: b.siteId }), mutates: true },
  'ai.restore': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, versionId: b.versionId }),
    mutates: true,
  },
  'ai.setText': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, sectionId: 'hero-main', path: 'heading', value: 'pwned' }),
    mutates: true,
  },
  'ai.setThemeColour': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, key: 'primary', value: '#ff0000' }),
    mutates: true,
  },
  'ai.toggleSection': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, sectionId: 'hero-main', hidden: true }),
    mutates: true,
  },
  'ai.reorderSections': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, pageId: 'home', sectionIds: ['hero-main'] }),
    mutates: true,
  },
  // Onboarding runs BEFORE an org exists, so there is no org to scope by. That makes
  // them 'authed' on this axis — but drafts hold a business name, description and phone
  // number keyed by user, so user-level isolation is checked separately below rather
  // than waved through.
  'onboarding.draft': { kind: 'authed' },
  'onboarding.saveDraft': { kind: 'authed' },
  'onboarding.complete': { kind: 'authed' },

  'ai.replaceImage': {
    kind: 'isolated',
    input: (b) => ({ siteId: b.siteId, sectionId: 'hero-main', path: 'image', assetId: 'asset_pwned123' }),
    mutates: true,
  },
}

const createCaller = createCallerFactory(appRouter)

function procedurePaths(): string[] {
  return Object.keys(
    (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
  ).sort()
}

function callerFor(userId: string | null) {
  const ctx: Context = { userId, isPlatformAdmin: false }
  return createCaller(ctx)
}

/** The TRPCError code, which is what callers branch on -- messages are for humans. */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'NO_ERROR'
  } catch (e) {
    return (e as { code?: string }).code ?? 'UNKNOWN'
  }
}

function invoke(userId: string | null, path: string, input: unknown) {
  const caller = callerFor(userId) as unknown as Record<string, unknown>
  const segments = path.split('.')
  let target: unknown = caller
  for (const s of segments) target = (target as Record<string, unknown>)[s]
  return (target as (i: unknown) => Promise<unknown>)(input)
}

/** Builds a complete, realistic org: user, membership, site, published version, lead. */
async function seedOrg(label: string) {
  const userId = randomUUID()
  const orgId = randomUUID()
  const siteId = randomUUID()
  const versionId = randomUUID()
  const slug = `iso-${label}-${orgId.slice(0, 8)}`

  await rawPrisma.users.create({
    data: { id: userId, email: `${slug}@example.test`, name: `Owner ${label}`, email_verified: true },
  })
  await rawPrisma.organizations.create({ data: { id: orgId, name: `Org ${label}`, slug, state: 'SA' } })
  await rawPrisma.memberships.create({ data: { org_id: orgId, user_id: userId, role: 'owner' } })
  await rawPrisma.sites.create({
    data: { id: siteId, org_id: orgId, name: `Site ${label}`, slug, status: 'draft' },
  })
  await rawPrisma.site_versions.create({
    data: {
      id: versionId,
      site_id: siteId,
      version: 1,
      spec_json: { specVersion: 1, secret: `${label} spec` },
      created_by: 'system',
      summary: `${label} v1`,
    },
  })
  await rawPrisma.sites.update({ where: { id: siteId }, data: { draft_version_id: versionId } })
  const lead = await rawPrisma.form_submissions.create({
    data: {
      site_id: siteId,
      payload: { message: `secret lead for ${label}` },
      email: `lead-${label}@example.test`,
      name: 'A Customer',
    },
  })

  return { userId, ids: { orgId, siteId, versionId, leadId: lead.id } as Ids, slug }
}

let A: Awaited<ReturnType<typeof seedOrg>>
let B: Awaited<ReturnType<typeof seedOrg>>

beforeAll(async () => {
  A = await seedOrg('a')
  B = await seedOrg('b')
})

afterAll(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: { in: [A.ids.orgId, B.ids.orgId] } } })
  await rawPrisma.users.deleteMany({ where: { id: { in: [A.userId, B.userId] } } })
  await rawPrisma.$disconnect()
})

describe('coverage', () => {
  it('every router procedure has an isolation strategy', () => {
    const uncovered = procedurePaths().filter((p) => !(p in COVERAGE))
    expect(
      uncovered,
      `These procedures have no entry in COVERAGE. Add one deciding how each is ` +
        `isolated before merging:\n  ${uncovered.join('\n  ')}`,
    ).toEqual([])
  })

  it('has no stale COVERAGE entries for procedures that no longer exist', () => {
    const paths = new Set(procedurePaths())
    expect(Object.keys(COVERAGE).filter((p) => !paths.has(p))).toEqual([])
  })
})

describe('unauthenticated access', () => {
  const orgScoped = () =>
    procedurePaths().filter((p) => COVERAGE[p]?.kind === 'isolated')

  it('every org-scoped procedure rejects an anonymous caller', async () => {
    for (const path of orgScoped()) {
      const strat = COVERAGE[path] as Extract<Strategy, { kind: 'isolated' }>
      expect(
        await codeOf(invoke(null, path, strat.input(B.ids))),
        `${path} allowed an anonymous caller`,
      ).toBe('UNAUTHORIZED')
    }
  })
})

describe('cross-tenant reads', () => {
  it('org A never receives org B rows from any procedure', async () => {
    const leaked: string[] = []

    for (const path of procedurePaths()) {
      // An uncovered procedure is reported by the coverage test above; skipping it here
      // keeps this failure message about leaks rather than a crash on undefined.
      const strat = COVERAGE[path]
      if (!strat || strat.kind !== 'isolated') continue

      let result: unknown
      try {
        result = await invoke(A.userId, path, strat.input(B.ids))
      } catch {
        continue // NOT_FOUND / FORBIDDEN is the correct outcome
      }

      // No throw: the result must contain nothing belonging to B.
      const blob = JSON.stringify(result ?? null)
      for (const secret of [B.ids.siteId, B.ids.orgId, B.ids.versionId, B.ids.leadId, B.slug]) {
        if (blob.includes(secret)) leaked.push(`${path} returned B's ${secret}`)
      }
      if (blob.includes('secret lead for b')) leaked.push(`${path} returned B's lead payload`)
      // exportCsv returns a flat string rather than rows, so it needs its own look.
      if (blob.includes('lead-b@example.test')) leaked.push(`${path} exported B's lead`)
    }

    expect(leaked, `Cross-tenant leak:\n  ${leaked.join('\n  ')}`).toEqual([])
  })

  it('org A still sees its OWN data, so the test is not passing vacuously', async () => {
    const sites = (await invoke(A.userId, 'site.list', undefined)) as Array<{ id: string }>
    expect(sites.map((s) => s.id)).toEqual([A.ids.siteId])

    const leads = (await invoke(A.userId, 'lead.list', { siteId: A.ids.siteId })) as unknown[]
    expect(leads).toHaveLength(1)
  })
})

describe('cross-tenant writes', () => {
  it("org A cannot mutate any of org B's rows", async () => {
    for (const path of procedurePaths()) {
      const strat = COVERAGE[path]
      if (strat?.kind !== 'isolated' || !strat.mutates) continue
      await invoke(A.userId, path, strat.input(B.ids)).catch(() => undefined)
    }

    // Nothing B owns may have moved.
    const site = await rawPrisma.sites.findUnique({ where: { id: B.ids.siteId } })
    expect(site?.name).toBe('Site b')
    expect(site?.status).toBe('draft')
    expect(site?.published_version_id).toBeNull()
    // The editing procedures write a new site_version and move the draft pointer.
    // Neither may happen for an org that does not own the site.
    expect(site?.draft_version_id).toBe(B.ids.versionId)
    expect(await rawPrisma.site_versions.count({ where: { site_id: B.ids.siteId } })).toBe(1)

    const org = await rawPrisma.organizations.findUnique({ where: { id: B.ids.orgId } })
    expect(org?.name).toBe('Org b')

    const lead = await rawPrisma.form_submissions.findUnique({ where: { id: B.ids.leadId } })
    expect(lead?.read_at).toBeNull()
    expect(lead?.archived_at).toBeNull()
  })
})

/**
 * Onboarding drafts are keyed by user, not by org, so org RLS does not cover them. A
 * draft holds the business name, what they do and their phone number before any of it
 * is public — worth its own check rather than a classification.
 */
describe('onboarding drafts are per user', () => {
  it('one user cannot read another’s draft', async () => {
    await invoke(A.userId, 'onboarding.saveDraft', {
      answers: { businessName: 'A Secret Trading Co', description: 'confidential' },
      step: 1,
    })
    const bDraft = (await invoke(B.userId, 'onboarding.draft', undefined)) as {
      answers: Record<string, unknown>
    }
    expect(JSON.stringify(bDraft.answers)).not.toContain('A Secret Trading Co')
    expect(bDraft.answers).toEqual({})
  })

  it('a user reads back their own draft', async () => {
    await invoke(A.userId, 'onboarding.saveDraft', {
      answers: { businessName: 'A Trading Co', description: 'x' },
      step: 2,
    })
    const mine = (await invoke(A.userId, 'onboarding.draft', undefined)) as {
      answers: { businessName?: string }
      step: number
    }
    expect(mine.answers.businessName).toBe('A Trading Co')
    expect(mine.step).toBe(2)
  })

  it('refuses a second business for a user who already has one', async () => {
    expect(
      await codeOf(
        invoke(A.userId, 'onboarding.complete', {
          answers: { businessName: 'Second Co', description: 'another one' },
        }),
      ),
    ).toBe('CONFLICT')
  })
})

describe('role enforcement', () => {
  it('a staff member cannot publish', async () => {
    await rawPrisma.memberships.updateMany({
      where: { org_id: A.ids.orgId, user_id: A.userId },
      data: { role: 'staff' },
    })
    expect(await codeOf(invoke(A.userId, 'site.publish', { siteId: A.ids.siteId }))).toBe(
      'FORBIDDEN',
    )
    await rawPrisma.memberships.updateMany({
      where: { org_id: A.ids.orgId, user_id: A.userId },
      data: { role: 'owner' },
    })
  })

  it('a user with no membership at all is refused', async () => {
    const stranger = randomUUID()
    await rawPrisma.users.create({
      data: { id: stranger, email: `stranger-${stranger.slice(0, 8)}@example.test`, name: 'Stranger' },
    })
    expect(await codeOf(invoke(stranger, 'site.list', undefined))).toBe('FORBIDDEN')
    await rawPrisma.users.delete({ where: { id: stranger } })
  })
})
