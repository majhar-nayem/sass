import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rawPrisma, type PrismaTx } from '@awning/db'
import { checkQuota, __resetRateLimiter } from '@awning/ai'
import { auditTrail, endImpersonation, grantAiCredit, ImpersonationRefused, startImpersonation } from '../admin.js'
import { collectDigest, digestAlerts, renderDigest } from '../monitoring.js'
import { generatePrivacyPolicy } from '@awning/spec'

/**
 * O-02 -- impersonation is the most dangerous capability in the codebase, so the tests
 * are mostly about what it refuses and what it records.
 */
const adminId = randomUUID()
const otherAdminId = randomUUID()
const customerId = randomUUID()
const orgId = randomUUID()
const db = () => rawPrisma as unknown as PrismaTx

beforeEach(async () => {
  await rawPrisma.audit_log.deleteMany({ where: { entity_id: customerId } })
  await rawPrisma.users.deleteMany({ where: { id: { in: [adminId, otherAdminId, customerId] } } })
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  const tag = orgId.slice(0, 8)
  await rawPrisma.users.createMany({
    data: [
      { id: adminId, email: `admin-${tag}@awning.test`, name: 'Operator', is_platform_admin: true },
      { id: otherAdminId, email: `admin2-${tag}@awning.test`, name: 'Other operator', is_platform_admin: true },
      { id: customerId, email: `dave-${tag}@example.test`, name: 'Dave' },
    ],
  })
  await rawPrisma.organizations.create({ data: { id: orgId, name: `adm-${tag}`, slug: `adm-${tag}` } })
  await rawPrisma.memberships.create({ data: { org_id: orgId, user_id: customerId, role: 'owner' } })
  await rawPrisma.subscriptions.create({
    data: { org_id: orgId, plan_code: 'founding', status: 'active' },
  })
  __resetRateLimiter()
})

afterAll(async () => {
  await rawPrisma.audit_log.deleteMany({ where: { entity_id: customerId } })
  await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
  await rawPrisma.users.deleteMany({ where: { id: { in: [adminId, otherAdminId, customerId] } } })
  await rawPrisma.$disconnect()
})

describe('impersonation', () => {
  it('creates a session attributable to the operator', async () => {
    const r = await startImpersonation(db(), adminId, customerId, { reason: 'debugging a publish failure' })
    expect(r.actingAs.id).toBe(customerId)

    const session = await rawPrisma.auth_sessions.findFirst({ where: { token: r.token } })
    expect(session?.user_id).toBe(customerId)
    // Without this, actions taken by an operator look like the customer's own doing.
    expect(session?.impersonated_by).toBe(adminId)
  })

  it('expires within the hour', async () => {
    const r = await startImpersonation(db(), adminId, customerId, { reason: 'support' })
    const minutes = (r.expiresAt.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(55)
    expect(minutes).toBeLessThanOrEqual(60)
  })

  /**
   * Otherwise one compromised operator account reaches every operator account, and the
   * audit trail stops distinguishing anyone from anyone.
   */
  it('refuses to impersonate another platform admin', async () => {
    await expect(startImpersonation(db(), adminId, otherAdminId, { reason: 'x' })).rejects.toThrow(
      ImpersonationRefused,
    )
    expect(await rawPrisma.auth_sessions.count({ where: { user_id: otherAdminId } })).toBe(0)
  })

  it('refuses a deleted user', async () => {
    await rawPrisma.users.update({ where: { id: customerId }, data: { deleted_at: new Date() } })
    await expect(startImpersonation(db(), adminId, customerId, { reason: 'x' })).rejects.toThrow()
  })

  /** Every use is recorded, with the stated reason, before the session exists. */
  it('writes an audit row carrying the reason', async () => {
    await startImpersonation(db(), adminId, customerId, { reason: 'customer reported a blank page' })
    const rows = await rawPrisma.audit_log.findMany({
      where: { action: 'admin.impersonate', entity_id: customerId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.actor_user_id).toBe(adminId)
    expect((rows[0]?.metadata as { reason?: string })?.reason).toMatch(/blank page/)
  })

  it('records the attempt even when the session is never used', async () => {
    const r = await startImpersonation(db(), adminId, customerId, { reason: 'support' })
    await endImpersonation(db(), r.token)
    expect(await rawPrisma.auth_sessions.count({ where: { token: r.token } })).toBe(0)
    const actions = (await rawPrisma.audit_log.findMany({ where: { entity_id: customerId } })).map((a) => a.action)
    expect(actions).toContain('admin.impersonate')
    expect(actions).toContain('admin.impersonate.end')
  })
})

describe('operator lifecycle', () => {
  /**
   * Revoking an operator must revoke the sessions they opened. Before this the foreign
   * key had no ON DELETE rule, so the delete was simply blocked — and their impersonated
   * sessions stayed live in the meantime.
   */
  it('deleting an operator kills their impersonated sessions and keeps the audit trail', async () => {
    const r = await startImpersonation(db(), adminId, customerId, { reason: 'support' })
    expect(await rawPrisma.auth_sessions.count({ where: { token: r.token } })).toBe(1)

    await rawPrisma.users.delete({ where: { id: adminId } })

    expect(await rawPrisma.auth_sessions.count({ where: { token: r.token } })).toBe(0)
    const trail = await rawPrisma.audit_log.findMany({ where: { entity_id: customerId } })
    expect(trail.length).toBeGreaterThan(0)
  })
})

describe('AI credit grants', () => {
  it('raises the org’s allowance without touching the plan', async () => {
    const before = await checkQuota(orgId, { skipRateLimit: true })
    await grantAiCredit(db(), adminId, orgId, 50, 'goodwill after a failed generation')
    const after = await checkQuota(orgId, { skipRateLimit: true })

    expect(after.limit).toBe(before.limit + 50)
    // The shared plan row must be untouched, or every org on it gets the grant too.
    const plan = await rawPrisma.plans.findUnique({ where: { code: 'founding' } })
    expect(plan?.ai_actions_month).toBe(400)
  })

  it('replaces an expired grant rather than stacking on it', async () => {
    await grantAiCredit(db(), adminId, orgId, 50, 'first')
    await rawPrisma.subscriptions.update({
      where: { org_id: orgId },
      data: { ai_bonus_expires_at: new Date(Date.now() - 864e5) },
    })
    const r = await grantAiCredit(db(), adminId, orgId, 30, 'second')
    expect(r.bonus).toBe(30)
  })

  it('is ignored once it expires', async () => {
    await grantAiCredit(db(), adminId, orgId, 50, 'x')
    await rawPrisma.subscriptions.update({
      where: { org_id: orgId },
      data: { ai_bonus_expires_at: new Date(Date.now() - 1000) },
    })
    expect((await checkQuota(orgId, { skipRateLimit: true })).limit).toBe(400)
  })

  it('demands a reason, because it goes in the audit log', async () => {
    await expect(grantAiCredit(db(), adminId, orgId, 50, '  ')).rejects.toThrow(/say why/i)
  })

  it.each([0, -10, 5000, 1.5])('refuses %s actions', async (n) => {
    await expect(grantAiCredit(db(), adminId, orgId, n, 'x')).rejects.toThrow()
  })

  it('shows up in the org’s audit trail', async () => {
    await grantAiCredit(db(), adminId, orgId, 50, 'goodwill')
    const trail = await auditTrail(db(), orgId)
    expect(trail.map((t) => t.action)).toContain('admin.grant_ai_credit')
  })
})

/**
 * O-04 -- the digest. Its value is entirely in what it flags, so the thresholds are the
 * thing worth testing.
 */
describe('the daily digest', () => {
  const base = {
    date: '2026-09-20', signups: 3, published: 1, activeCustomers: 12, mrrCents: 48_000,
    aiSpendCents: 200, aiSpendCeilingCents: 4000, aiFailureRate: 0.01,
    enquiries: 9, enquiriesNotEmailed: 0, domainsStuck: [], pastDue: 0, suspended: 0, brokenSites: 0,
  }

  it('says so plainly when there is nothing to do', () => {
    expect(digestAlerts(base)).toEqual([])
    expect(renderDigest(base).subject).toMatch(/all good/)
  })

  /** The one that costs a customer directly: their lead exists and they never heard. */
  it('flags enquiries that were saved but never emailed', () => {
    const alerts = digestAlerts({ ...base, enquiriesNotEmailed: 2 })
    expect(alerts.join()).toMatch(/NOT emailed/i)
  })

  it('flags AI spend approaching the ceiling before it trips', () => {
    expect(digestAlerts({ ...base, aiSpendCents: 3200 }).join()).toMatch(/AI spend/)
    expect(digestAlerts({ ...base, aiSpendCents: 3199 })).toEqual([])
  })

  it('flags a rising AI failure rate as prompt or schema drift', () => {
    expect(digestAlerts({ ...base, aiFailureRate: 0.12 }).join()).toMatch(/drifted/)
  })

  it('flags domains stuck over a day, with the reason', () => {
    const d = {
      ...base,
      domainsStuck: [{ hostname: 'dave.com.au', status: 'verifying', hoursWaiting: 30, problem: 'Parking page still there.' }],
    }
    expect(digestAlerts(d).join()).toMatch(/stuck/)
    expect(renderDigest(d).text).toMatch(/Parking page still there/)
  })

  it('puts the count in the subject so a phone is enough', () => {
    expect(renderDigest({ ...base, enquiriesNotEmailed: 2, brokenSites: 1 }).subject).toMatch(/2 to look at/)
  })

  it('reads real data without throwing', async () => {
    const d = await collectDigest(db())
    expect(typeof d.activeCustomers).toBe('number')
    expect(renderDigest(d).text).toContain('Awning —')
  })
})

/** O-05 -- the policy has to describe what the site actually does. */
describe('the generated privacy policy', () => {
  const inputs = {
    businessName: "Dave's Gas & Plumbing",
    abn: '51824753556',
    email: 'dave@example.test',
    phone: '08 8123 4567',
    suburb: 'Salisbury',
    state: 'SA',
    collects: { contactForm: true, newsletter: false, onlineOrders: false, analytics: true },
  }

  it('describes the enquiry form when there is one', () => {
    const p = generatePrivacyPolicy(inputs)
    expect(p).toMatch(/enquiry form/)
    expect(p).toMatch(/51 824 753 556/)
    expect(p).toMatch(/Australian Privacy Principles/)
    expect(p).toMatch(/oaic\.gov\.au/)
  })

  /** A site with no shop must not claim to process payments. */
  it('says nothing about payments or Stripe when there is no shop', () => {
    const p = generatePrivacyPolicy(inputs)
    expect(p).not.toMatch(/Stripe/)
    expect(p).not.toMatch(/card details/)
  })

  it('covers payments and the seven-year record when there is a shop', () => {
    const p = generatePrivacyPolicy({ ...inputs, collects: { ...inputs.collects, onlineOrders: true } })
    expect(p).toMatch(/Stripe/)
    expect(p).toMatch(/seven years/)
  })

  /** A brochure site genuinely collects nothing, and saying so is better boilerplate. */
  it('says so when the site collects nothing at all', () => {
    const p = generatePrivacyPolicy({
      ...inputs,
      collects: { contactForm: false, newsletter: false, onlineOrders: false, analytics: false },
    })
    expect(p).toMatch(/does not collect personal information/)
  })

  it('only promises an unsubscribe link when there is a newsletter', () => {
    expect(generatePrivacyPolicy(inputs)).not.toMatch(/unsubscribe/)
    expect(
      generatePrivacyPolicy({ ...inputs, collects: { ...inputs.collects, newsletter: true } }),
    ).toMatch(/unsubscribe/)
  })

  /** It must not read as legal advice, because it is not. */
  it('says where its limits are', () => {
    expect(generatePrivacyPolicy(inputs)).toMatch(/get advice/)
  })

  it('never invents an ABN', () => {
    expect(generatePrivacyPolicy({ ...inputs, abn: null })).not.toMatch(/ABN/)
  })
})
