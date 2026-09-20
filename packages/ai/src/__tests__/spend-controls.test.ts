import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rawPrisma } from '@awning/db'
import { __resetRateLimiter, checkQuota, PLATFORM_DAILY_CEILING } from '../quota.js'
import { costCentsAud, MODELS, ROUTING } from '../models.js'

/**
 * A-07 -- the spend controls, against real Postgres.
 *
 * These are the tests that decide whether a runaway loop costs twenty dollars or four
 * thousand, so they assert on behaviour rather than on the presence of the code.
 */

const orgId = randomUUID()
const otherOrgId = randomUUID()

async function seedOrg(id: string, plan: string) {
  const slug = `ai-${id.slice(0, 8)}`
  await rawPrisma.organizations.create({ data: { id, name: slug, slug, state: 'SA' } })
  await rawPrisma.subscriptions.create({ data: { org_id: id, plan_code: plan, status: 'active' } })
}

async function logUsage(id: string, n: number, costCents: number, countsToQuota = true) {
  for (let i = 0; i < n; i++)
    await rawPrisma.ai_usage.create({
      data: {
        org_id: id,
        action_type: 'edit',
        model: MODELS.haiku.id,
        cost_cents_aud: costCents,
        counts_to_quota: countsToQuota,
        success: true,
      },
    })
}

beforeAll(async () => {
  await seedOrg(orgId, 'founding')
  await seedOrg(otherOrgId, 'store')
})

afterEach(async () => {
  await rawPrisma.ai_usage.deleteMany({ where: { org_id: { in: [orgId, otherOrgId] } } })
  __resetRateLimiter()
})

afterAll(async () => {
  await rawPrisma.organizations.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })
  await rawPrisma.$disconnect()
})

describe('plan quota', () => {
  it('allows a fresh org', async () => {
    const d = await checkQuota(orgId)
    expect(d.allowed).toBe(true)
    expect(d.limit).toBe(400) // founding plan
  })

  it('blocks once the monthly action count is reached', async () => {
    await logUsage(orgId, 400, 0.1)
    const d = await checkQuota(orgId, { skipRateLimit: true })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('quota_exhausted')
  })

  /** A hard wall mid-edit is a churn event; the message has to offer a way forward. */
  it('offers a top-up rather than just refusing', async () => {
    await logUsage(orgId, 400, 0.1)
    const d = await checkQuota(orgId, { skipRateLimit: true })
    expect(d.message).toMatch(/top up/i)
    expect(d.message).toMatch(/reset/i)
  })

  it('does not count usage marked as not counting to quota', async () => {
    // Retries caused by our own validator failing are not the customer's fault.
    await logUsage(orgId, 400, 0.1, false)
    expect((await checkQuota(orgId, { skipRateLimit: true })).allowed).toBe(true)
  })

  it('counts each org separately', async () => {
    await logUsage(orgId, 400, 0.1)
    expect((await checkQuota(orgId, { skipRateLimit: true })).allowed).toBe(false)
    expect((await checkQuota(otherOrgId, { skipRateLimit: true })).allowed).toBe(true)
  })
})

describe('per-org spend cap', () => {
  /**
   * The case quota alone cannot catch: a loop making thousands of tiny calls stays under
   * the action limit for a long time while the bill climbs.
   */
  it('trips on dollars even when the action count is fine', async () => {
    await logUsage(orgId, 20, 40) // 20 actions, A$8.00 — well under 400 actions
    const d = await checkQuota(orgId, { skipRateLimit: true })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('org_spend_cap')
    expect(d.spentCents).toBeGreaterThanOrEqual(d.capCents)
  })
})

describe('rate limit', () => {
  it('allows a normal burst then throttles', async () => {
    const results = []
    for (let i = 0; i < 10; i++) results.push((await checkQuota(orgId)).allowed)
    expect(results.slice(0, 8).every(Boolean)).toBe(true)
    expect(results.at(-1)).toBe(false)
  })

  it('throttles per org, not globally', async () => {
    for (let i = 0; i < 10; i++) await checkQuota(orgId)
    expect((await checkQuota(otherOrgId)).allowed).toBe(true)
  })
})

describe('platform circuit breaker', () => {
  /**
   * The one that matters at 3am: global, so a single runaway org cannot spend the whole
   * budget while nobody is awake. It blocks every org, including innocent ones — that is
   * the trade, and it is the right one.
   */
  it('opens for everyone once the daily platform ceiling is reached', async () => {
    await logUsage(otherOrgId, 1, PLATFORM_DAILY_CEILING)
    const d = await checkQuota(orgId, { skipRateLimit: true })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('platform_circuit_open')
  })

  it('does not leak internals to the customer', async () => {
    await logUsage(otherOrgId, 1, PLATFORM_DAILY_CEILING)
    const d = await checkQuota(orgId, { skipRateLimit: true })
    expect(d.message).not.toMatch(/circuit|ceiling|quota|\$/i)
  })
})

describe('no subscription', () => {
  it('refuses an org with no plan', async () => {
    const naked = randomUUID()
    const slug = `ai-${naked.slice(0, 8)}`
    await rawPrisma.organizations.create({ data: { id: naked, name: slug, slug } })
    const d = await checkQuota(naked, { skipRateLimit: true })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('no_subscription')
    await rawPrisma.organizations.delete({ where: { id: naked } })
  })
})

describe('cost model', () => {
  it('prices a generation on Opus', () => {
    // A realistic site: 4.3k cached prefix, 1.2k fresh input, 8k output.
    const cents = costCentsAud('opus', {
      inputTokens: 1200,
      outputTokens: 8000,
      cacheReadTokens: 4300,
      cacheWriteTokens: 0,
    })
    expect(cents).toBeGreaterThan(20)
    expect(cents).toBeLessThan(40)
  })

  it('prices a simple edit on Haiku at well under a cent', () => {
    const cents = costCentsAud('haiku', {
      inputTokens: 1200,
      outputTokens: 200,
      cacheReadTokens: 4300,
      cacheWriteTokens: 0,
    })
    expect(cents).toBeLessThan(1)
  })

  /** The whole argument for the cached prefix. */
  it('makes cache reads roughly ten times cheaper than fresh input', () => {
    const fresh = costCentsAud('opus', { inputTokens: 10_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const cached = costCentsAud('opus', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10_000, cacheWriteTokens: 0 })
    expect(cached).toBeCloseTo(fresh * 0.1, 3)
  })

  it('routes mechanical work to Haiku and judgement to Opus', () => {
    expect(ROUTING.edit).toBe('haiku')
    expect(ROUTING.seo).toBe('haiku')
    expect(ROUTING.generate).toBe('opus')
    expect(ROUTING.rewrite).toBe('opus')
  })

  /**
   * The number the business case rests on. A typical customer: 2 generations, 45 edits,
   * 6 rewrites a month.
   */
  it('keeps a typical customer under A$2/month', () => {
    const gen = 2 * costCentsAud('opus', { inputTokens: 1200, outputTokens: 8000, cacheReadTokens: 4300, cacheWriteTokens: 0 })
    const edits = 45 * costCentsAud('haiku', { inputTokens: 1200, outputTokens: 200, cacheReadTokens: 4300, cacheWriteTokens: 0 })
    const rewrites = 6 * costCentsAud('opus', { inputTokens: 1500, outputTokens: 900, cacheReadTokens: 4300, cacheWriteTokens: 0 })
    const monthly = (gen + edits + rewrites) / 100
    expect(monthly).toBeLessThan(2)
  })
})
