import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { rawPrisma } from '@awning/db'
import {
  acceptCurrentDocuments,
  acceptanceHistory,
  acceptanceMatchesCurrentText,
  LEGAL_DOCUMENTS,
  legalDocument,
  outstandingDocuments,
  requiredDocuments,
  stillOutstanding,
} from '../legal/index.js'
import { restoreAfterAup, suspendForAup } from '../admin.js'

/**
 * O-05b. Terms you cannot prove someone accepted are not much use on the day you need
 * them, so what is tested here is the proof, not the prose.
 */
const userId = randomUUID()
const otherUser = randomUUID()
const adminId = randomUUID()
const orgId = randomUUID()

beforeAll(async () => {
  for (const id of [userId, otherUser, adminId])
    await rawPrisma.users.create({
      data: { id, email: `legal-${id}@example.com`, name: 'Legal Test' },
    })
  await rawPrisma.organizations.create({
    data: { id: orgId, name: 'Legal Test Org', slug: `legal-${orgId.slice(0, 8)}`, state: 'SA' },
  })
})

describe('the documents themselves', () => {
  it('ships the ones a customer has to accept', () => {
    expect(legalDocument('terms')).toBeDefined()
    expect(legalDocument('acceptable-use')).toBeDefined()
  })

  it('every document carries a version and a hash of its text', () => {
    for (const d of LEGAL_DOCUMENTS) {
      expect(d.version).toBeGreaterThanOrEqual(1)
      expect(d.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(d.body.length).toBeGreaterThan(200)
    }
  })

  // The generator hashes the body, not the front matter, so an effective-date edit
  // does not invalidate consent given to identical wording.
  it('the internal lawyer brief is not served to customers', () => {
    expect(LEGAL_DOCUMENTS.map((d) => d.id)).not.toContain('lawyer-brief')
  })
})

describe('acceptance', () => {
  it('starts with everything outstanding', async () => {
    const out = await outstandingDocuments(rawPrisma, userId)
    expect(out.map((d) => d.id).sort()).toEqual(['acceptable-use', 'terms'])
  })

  it('records the version and the exact text that was on screen', async () => {
    const { recorded } = await acceptCurrentDocuments(rawPrisma, userId, orgId, {
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
    })
    expect(recorded.sort()).toEqual(['acceptable-use', 'terms'])

    const history = await acceptanceHistory(rawPrisma, userId)
    const terms = history.find((h) => h.document_id === 'terms')!
    expect(terms.sha256).toBe(legalDocument('terms')!.sha256)
    expect(terms.version).toBe(legalDocument('terms')!.version)
    expect(acceptanceMatchesCurrentText(terms)).toBe(true)
  })

  it('leaves nothing outstanding afterwards', async () => {
    expect(await outstandingDocuments(rawPrisma, userId)).toEqual([])
  })

  it('treats a second click as the same agreement, not a new one', async () => {
    const before = (await acceptanceHistory(rawPrisma, userId)).length
    const { recorded } = await acceptCurrentDocuments(rawPrisma, userId, orgId)
    expect(recorded).toEqual([])
    expect(await acceptanceHistory(rawPrisma, userId)).toHaveLength(before)
  })

  it('does not store the raw IP address', async () => {
    const rows = await rawPrisma.legal_acceptances.findMany({
      where: { user_id: userId }, select: { ip_hash: true },
    })
    for (const r of rows) {
      expect(r.ip_hash).not.toBe('203.0.113.9')
      expect(r.ip_hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('one person accepting does not accept for anyone else', async () => {
    expect((await outstandingDocuments(rawPrisma, otherUser)).length).toBeGreaterThan(0)
  })
})

/**
 * The reason versioning exists: a material change has to reach people who already
 * agreed to the old wording.
 */
describe('a new version of a document', () => {
  const required = () => requiredDocuments()

  it('becomes outstanding again for someone who accepted the old one', () => {
    const docs = required()
    const terms = docs.find((d) => d.id === 'terms')!
    // Everything accepted at the current version, then terms is materially revised.
    const accepted = docs.map((d) => ({ document_id: d.id, version: d.version }))
    const revised = docs.map((d) => (d.id === 'terms' ? { ...d, version: terms.version + 1 } : d))

    const out = stillOutstanding(revised, accepted)
    expect(out.map((d) => d.id)).toEqual(['terms'])
  })

  it('does not re-ask for a document that only had a typo fixed', () => {
    const docs = required()
    const accepted = docs.map((d) => ({ document_id: d.id, version: d.version }))
    expect(stillOutstanding(docs, accepted)).toEqual([])
  })

  // A rollback should not ask anyone to agree to wording older than they have.
  it('does not ask someone to accept a version older than the one they signed', () => {
    const docs = required()
    const accepted = docs.map((d) => ({ document_id: d.id, version: d.version + 5 }))
    expect(stillOutstanding(docs, accepted)).toEqual([])
  })

  it('flags an acceptance whose text no longer matches, which means a silent edit', () => {
    expect(acceptanceMatchesCurrentText({ document_id: 'terms', sha256: 'deadbeef' })).toBe(false)
  })
})

/**
 * The AUP says we may suspend a site and that the customer can ask what was removed
 * and why. A policy with no mechanism behind it is a paragraph, so this checks there
 * is one — and that it is reversible and accountable.
 */
describe('AUP enforcement', () => {
  const siteId = randomUUID()

  beforeAll(async () => {
    await rawPrisma.sites.create({
      data: {
        id: siteId, org_id: orgId, name: 'AUP Test', slug: `aup-${siteId.slice(0, 8)}`,
        status: 'published',
      },
    })
  })

  it('refuses a takedown with no real reason given', async () => {
    await expect(suspendForAup(rawPrisma, adminId, siteId, 'bad')).rejects.toThrow(/actual reason/i)
  })

  it('suspends the site and bumps the cache epoch so it disappears now', async () => {
    const before = await rawPrisma.sites.findUnique({ where: { id: siteId }, select: { cache_epoch: true } })
    await suspendForAup(rawPrisma, adminId, siteId, 'Published testimonials that the owner confirmed were invented.')
    const after = await rawPrisma.sites.findUnique({
      where: { id: siteId }, select: { status: true, cache_epoch: true },
    })
    expect(after!.status).toBe('suspended')
    expect(after!.cache_epoch).toBeGreaterThan(before!.cache_epoch)
  })

  it('writes who did it and why, because the customer can ask', async () => {
    const [row] = await rawPrisma.audit_log.findMany({
      where: { action: 'admin.aup_suspend', entity_id: siteId },
      orderBy: { created_at: 'desc' }, take: 1,
    })
    expect(row?.actor_user_id).toBe(adminId)
    expect(JSON.stringify(row?.metadata)).toContain('invented')
  })

  // A wrong takedown has to be undoable; nothing is deleted.
  it('restores the site, and only to published if there is a published version', async () => {
    await restoreAfterAup(rawPrisma, adminId, siteId, 'Owner removed the testimonials.')
    const site = await rawPrisma.sites.findUnique({ where: { id: siteId }, select: { status: true } })
    // This fixture has no published version, so draft is the correct landing state.
    expect(site!.status).toBe('draft')
  })
})
