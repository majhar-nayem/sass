import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rawPrisma, withOrgContext, type PrismaTx } from '@awning/db'
import type { WebsiteSpec } from '@awning/spec'
import { currentDraftSpec, pruneVersions, restoreVersion, undoLastChange, writeVersion } from '../versions.js'

/**
 * A-10 -- version history and undo, against real Postgres.
 *
 * Undo is the safety net that makes conversational editing acceptable: it is what lets
 * an owner try something at 9pm without fear. If it is subtly wrong — off by one, or it
 * quietly publishes — the product is worse than not having it.
 */

const orgId = randomUUID()
const siteId = randomUUID()
const userId = randomUUID()

const specWith = (heading: string): WebsiteSpec =>
  ({
    specVersion: 1,
    site: { businessName: 'V Test', industry: 'plumber', style: 'bold-trade', tone: 'direct', locale: 'en-AU', currency: 'AUD', showAbnInFooter: true },
    theme: { primary: '#12324A', secondary: '#F3F5F7', accent: '#E4622B', neutral: '#16181A', headingFont: 'Archivo', bodyFont: 'Inter', radius: 'sm', density: 'comfortable', shadow: 'subtle', buttonStyle: 'solid', darkMode: false },
    pages: [{ id: 'home', path: '/', title: 'V Test', sections: [{ id: 'hero-main', type: 'hero', variant: 'bold', hidden: false, background: 'default', spacing: 'lg', props: { heading, height: 'medium', align: 'left' } }] }],
  }) as unknown as WebsiteSpec

const db = () => rawPrisma as unknown as PrismaTx

/** Read the heading rather than substring-matching the JSON: "secondary" in the theme
 *  contains "second", which makes a naive contains() assertion quietly meaningless. */
const headingOf = (spec: WebsiteSpec | null): string | undefined =>
  (spec?.pages[0]?.sections[0]?.props as { heading?: string } | undefined)?.heading

beforeEach(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  await rawPrisma.users.deleteMany({ where: { id: userId } })
  const slug = `ver-${siteId.slice(0, 8)}`
  await rawPrisma.users.create({ data: { id: userId, email: `${slug}@example.test`, name: 'Owner' } })
  await rawPrisma.organizations.create({ data: { id: orgId, name: slug, slug } })
  await rawPrisma.memberships.create({ data: { org_id: orgId, user_id: userId, role: 'owner' } })
  await rawPrisma.sites.create({ data: { id: siteId, org_id: orgId, name: slug, slug, status: 'draft' } })
})

afterAll(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  await rawPrisma.users.deleteMany({ where: { id: userId } })
  await rawPrisma.$disconnect()
})

describe('writeVersion', () => {
  it('numbers versions sequentially and chains them', async () => {
    const v1 = await writeVersion(db(), { siteId, spec: specWith('one'), summary: 'one', createdBy: 'ai' })
    const v2 = await writeVersion(db(), { siteId, spec: specWith('two'), summary: 'two', createdBy: 'ai' })
    expect(v1.version).toBe(1)
    expect(v2.version).toBe(2)

    const row = await rawPrisma.site_versions.findUnique({ where: { id: v2.id }, select: { parent_version_id: true } })
    expect(row?.parent_version_id).toBe(v1.id)
  })

  it('moves the draft pointer', async () => {
    const v = await writeVersion(db(), { siteId, spec: specWith('x'), summary: 'x', createdBy: 'ai' })
    const site = await rawPrisma.sites.findUnique({ where: { id: siteId }, select: { draft_version_id: true } })
    expect(site?.draft_version_id).toBe(v.id)
  })

  /**
   * The property the whole editing flow rests on: editing is not publishing. An owner
   * can change anything and the public sees nothing until they say so.
   */
  it('never touches the published pointer', async () => {
    const v1 = await writeVersion(db(), { siteId, spec: specWith('published'), summary: 'v1', createdBy: 'ai' })
    await rawPrisma.sites.update({ where: { id: siteId }, data: { published_version_id: v1.id, status: 'published' } })

    await writeVersion(db(), { siteId, spec: specWith('draft edit'), summary: 'v2', createdBy: 'ai' })

    const site = await rawPrisma.sites.findUnique({ where: { id: siteId }, select: { published_version_id: true } })
    expect(site?.published_version_id).toBe(v1.id)

    const published = await rawPrisma.site_versions.findUnique({ where: { id: v1.id }, select: { spec_json: true } })
    expect(headingOf(published?.spec_json as WebsiteSpec)).toBe('published')
  })

  it('leaves earlier versions untouched', async () => {
    const v1 = await writeVersion(db(), { siteId, spec: specWith('original'), summary: 'v1', createdBy: 'ai' })
    await writeVersion(db(), { siteId, spec: specWith('changed'), summary: 'v2', createdBy: 'ai' })
    const row = await rawPrisma.site_versions.findUnique({ where: { id: v1.id }, select: { spec_json: true, summary: true } })
    expect(headingOf(row?.spec_json as WebsiteSpec)).toBe('original')
    expect(row?.summary).toBe('v1')
  })
})

describe('undo', () => {
  it('returns the previous content', async () => {
    await writeVersion(db(), { siteId, spec: specWith('first'), summary: 'first', createdBy: 'ai' })
    await writeVersion(db(), { siteId, spec: specWith('second'), summary: 'Changed the heading', createdBy: 'ai' })

    const undone = await undoLastChange(db(), siteId, userId)
    expect(undone).not.toBeNull()

    expect(headingOf(await currentDraftSpec(db(), siteId))).toBe('first')
  })

  /**
   * Undo writes a new version rather than moving the pointer back. That makes undo
   * itself undoable and keeps the history honest about what happened.
   */
  it('is itself undoable', async () => {
    await writeVersion(db(), { siteId, spec: specWith('first'), summary: 'first', createdBy: 'ai' })
    await writeVersion(db(), { siteId, spec: specWith('second'), summary: 'second', createdBy: 'ai' })

    await undoLastChange(db(), siteId, userId)
    expect(headingOf(await currentDraftSpec(db(), siteId))).toBe('first')

    await undoLastChange(db(), siteId, userId)
    expect(headingOf(await currentDraftSpec(db(), siteId))).toBe('second')
  })

  it('says what it undid, in the owner’s language', async () => {
    await writeVersion(db(), { siteId, spec: specWith('a'), summary: 'a', createdBy: 'ai' })
    await writeVersion(db(), { siteId, spec: specWith('b'), summary: 'Changed the colours', createdBy: 'ai' })
    const undone = await undoLastChange(db(), siteId, userId)
    expect(undone?.summary).toBe('Undid: Changed the colours')
  })

  it('returns null at the start of history rather than throwing', async () => {
    await writeVersion(db(), { siteId, spec: specWith('only'), summary: 'only', createdBy: 'template' })
    expect(await undoLastChange(db(), siteId, userId)).toBeNull()
  })

  it('returns null for a site with no versions at all', async () => {
    expect(await undoLastChange(db(), siteId, userId)).toBeNull()
  })
})

describe('restore', () => {
  it('brings back an older version as a new one', async () => {
    const v1 = await writeVersion(db(), { siteId, spec: specWith('oldest'), summary: 'v1', createdBy: 'ai' })
    await writeVersion(db(), { siteId, spec: specWith('middle'), summary: 'v2', createdBy: 'ai' })
    await writeVersion(db(), { siteId, spec: specWith('newest'), summary: 'v3', createdBy: 'ai' })

    const restored = await restoreVersion(db(), siteId, v1.id, userId)
    expect(restored.version).toBe(4)
    expect(headingOf(await currentDraftSpec(db(), siteId))).toBe('oldest')
    expect(restored.summary).toMatch(/Restored version 1/)
  })

  /** Defence in depth behind RLS: a version id from another site must not resolve. */
  it('refuses a version belonging to a different site', async () => {
    const otherSite = randomUUID()
    await rawPrisma.sites.create({ data: { id: otherSite, org_id: orgId, name: 'other', slug: `o-${otherSite.slice(0, 8)}` } })
    const theirs = await writeVersion(db(), { siteId: otherSite, spec: specWith('theirs'), summary: 'x', createdBy: 'ai' })
    await writeVersion(db(), { siteId, spec: specWith('mine'), summary: 'mine', createdBy: 'ai' })

    await expect(restoreVersion(db(), siteId, theirs.id, userId)).rejects.toThrow()
  })
})

describe('pruning', () => {
  it('keeps recent history and anything undo still needs', async () => {
    const old = new Date(Date.now() - 200 * 864e5)
    for (let i = 0; i < 6; i++) {
      const v = await writeVersion(db(), { siteId, spec: specWith(`v${i}`), summary: `v${i}`, createdBy: 'ai' })
      if (i < 3) await rawPrisma.site_versions.update({ where: { id: v.id }, data: { created_at: old } })
    }
    const before = await rawPrisma.site_versions.count({ where: { site_id: siteId } })
    const removed = await pruneVersions(db(), siteId)

    // Under 50 versions, everything is protected regardless of age — otherwise undo
    // would break on a site nobody has touched in three months.
    expect(removed).toBe(0)
    expect(await rawPrisma.site_versions.count({ where: { site_id: siteId } })).toBe(before)
  })
})

describe('under org context', () => {
  it('works through withOrgContext, which is how the router calls it', async () => {
    const v = await withOrgContext(orgId, (tx) =>
      writeVersion(tx, { siteId, spec: specWith('scoped'), summary: 'scoped', createdBy: 'user', createdByUser: userId }),
    )
    expect(v.version).toBe(1)
    const spec = await withOrgContext(orgId, (tx) => currentDraftSpec(tx, siteId))
    expect(headingOf(spec)).toBe('scoped')
  })
})
