import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rawPrisma, type PrismaTx } from '@awning/db'
import { __setTransport, __useCapturingTransport } from '@awning/integrations/mail'
import { decideDunning, GRACE_DAYS, restoreAfterPayment, runDunning } from '../dunning.js'

/**
 * O-03 -- the dunning schedule.
 *
 * The property that matters is negative: a failed payment must NOT take a site offline
 * early. Expired cards are the biggest cause of involuntary churn at this price, and
 * switching the website off on day one is how a customer is lost permanently rather
 * than for a week.
 */
const base = { siteName: "Dave's Plumbing", manageUrl: 'https://app.awning.au/billing' }

describe('the decision table', () => {
  it.each([
    [0, 'none'],
    [1, 'email'],
    [2, 'none'],
    [3, 'email'],
    [4, 'none'],
    [7, 'email'],
    [10, 'none'],
    [13, 'none'],
    [14, 'suspend'],
    [30, 'suspend'],
  ])('day %i -> %s', (daysPastDue, expected) => {
    // emailsSent reflects a run that has kept up: every reminder already due.
    const emailsSent = [1, 3, 7].filter((d) => d < daysPastDue)
    expect(decideDunning({ ...base, daysPastDue, emailsSent }).action).toBe(expected)
  })

  /** The whole point of the grace window. */
  it('never suspends before day 14', () => {
    for (let d = 0; d < GRACE_DAYS; d++)
      expect(decideDunning({ ...base, daysPastDue: d, emailsSent: [1, 3, 7] }).action).not.toBe('suspend')
  })

  it('does not resend a reminder that already went out', () => {
    expect(decideDunning({ ...base, daysPastDue: 3, emailsSent: [1, 3] }).action).toBe('none')
  })

  /** If the cron misses a day, the owner still gets the reminder rather than a skip. */
  it('catches up after a missed run', () => {
    const d = decideDunning({ ...base, daysPastDue: 5, emailsSent: [1] })
    expect(d).toMatchObject({ action: 'email', day: 3 })
  })

  it('sends only the latest due reminder, not a backlog at once', () => {
    const d = decideDunning({ ...base, daysPastDue: 9, emailsSent: [] })
    expect(d).toMatchObject({ action: 'email', day: 7 })
  })

  it('only mentions going offline in the final reminder', () => {
    const day1 = decideDunning({ ...base, daysPastDue: 1, emailsSent: [] })
    const day7 = decideDunning({ ...base, daysPastDue: 7, emailsSent: [1, 3] })
    expect(day1.action === 'email' && day1.body).toMatch(/still live/i)
    expect(day1.action === 'email' && day1.body).not.toMatch(/offline/i)
    expect(day7.action === 'email' && day7.subject).toMatch(/offline in 7 days/i)
  })

  it('always offers a way out rather than only a way to pay', () => {
    const d = decideDunning({ ...base, daysPastDue: 7, emailsSent: [1, 3] })
    expect(d.action === 'email' && d.body).toMatch(/cancel/i)
  })
})

describe('runDunning against the database', () => {
  const orgId = randomUUID()
  const siteId = randomUUID()
  const db = () => rawPrisma as unknown as PrismaTx
  let captured: { sent: Array<{ subject: string; to: string }> }

  beforeEach(async () => {
    captured = __useCapturingTransport()
    await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
    const slug = `dun-${orgId.slice(0, 8)}`
    await rawPrisma.organizations.create({
      data: { id: orgId, name: slug, slug, billing_email: 'dave@example.test' },
    })
    await rawPrisma.sites.create({
      data: { id: siteId, org_id: orgId, name: slug, slug, status: 'published' },
    })
    await rawPrisma.subscriptions.create({
      data: { org_id: orgId, plan_code: 'founding', status: 'past_due' },
    })
  })

  afterAll(async () => {
    await rawPrisma.organizations.deleteMany({ where: { id: orgId } })
    __setTransport(null)
    await rawPrisma.$disconnect()
  })

  const agePastDue = (days: number) =>
    rawPrisma.subscriptions.update({
      where: { org_id: orgId },
      data: { updated_at: new Date(Date.now() - days * 864e5) },
    })

  const siteStatus = async () =>
    (await rawPrisma.sites.findUnique({ where: { id: siteId }, select: { status: true } }))?.status

  it('day 1: emails and leaves the site published', async () => {
    await agePastDue(1)
    const run = await runDunning(db())
    expect(run.emailed).toBe(1)
    expect(run.suspended).toBe(0)
    expect(await siteStatus()).toBe('published')
    expect(captured.sent).toHaveLength(1)
    expect(captured.sent[0]!.to).toBe('dave@example.test')
    expect(captured.sent[0]!.subject).toMatch(/didn't go through/i)
  })

  it('day 13: still published', async () => {
    await agePastDue(13)
    await runDunning(db())
    expect(await siteStatus()).toBe('published')
  })

  it('day 14: suspends', async () => {
    await agePastDue(14)
    const run = await runDunning(db())
    expect(run.suspended).toBe(1)
    expect(await siteStatus()).toBe('suspended')
  })

  it('records which reminders went out, so a second run that day sends nothing', async () => {
    await agePastDue(1)
    await runDunning(db())
    const after = await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } })
    expect(after?.dunning_emails_sent).toEqual([1])

    const second = await runDunning(db())
    expect(second.emailed).toBe(0)
  })

  /**
   * Asserts on this org rather than on the global counts: the sweep is deliberately
   * global, so other rows in a shared database would make a total meaningless.
   */
  it('leaves an active subscription alone entirely', async () => {
    await rawPrisma.subscriptions.update({ where: { org_id: orgId }, data: { status: 'active' } })
    await runDunning(db())
    expect(captured.sent.filter((m) => m.to === 'dave@example.test')).toHaveLength(0)
    expect(await siteStatus()).toBe('published')
  })

  /** Paying must bring the site straight back, and reset the schedule. */
  it('restores a suspended site the moment payment succeeds', async () => {
    await agePastDue(14)
    await runDunning(db())
    expect(await siteStatus()).toBe('suspended')

    const restored = await restoreAfterPayment(db(), orgId)
    expect(restored).toBe(1)
    expect(await siteStatus()).toBe('published')

    const sub = await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } })
    expect(sub?.dunning_emails_sent).toEqual([])
  })

  it('bumps the cache epoch on suspend and restore, so the CDN follows', async () => {
    const before = (await rawPrisma.sites.findUnique({ where: { id: siteId } }))!.cache_epoch
    await agePastDue(14)
    await runDunning(db())
    await restoreAfterPayment(db(), orgId)
    const after = (await rawPrisma.sites.findUnique({ where: { id: siteId } }))!.cache_epoch
    expect(after).toBe(before + 2)
  })
})
