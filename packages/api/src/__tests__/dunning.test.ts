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

  /**
   * Asserts on this org's outcome, not on the run's totals. The sweep is global by
   * design, so a shared database makes a total a measure of the other tests.
   */
  it('day 1: emails and leaves the site published', async () => {
    await agePastDue(1)
    await runDunning(db())
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
    await runDunning(db())
    expect(await siteStatus()).toBe('suspended')
  })

  it('records which reminders went out, so a second run that day sends nothing', async () => {
    await agePastDue(1)
    await runDunning(db())
    const after = await rawPrisma.subscriptions.findUnique({ where: { org_id: orgId } })
    expect(after?.dunning_emails_sent).toEqual([1])

    const before = captured.sent.length
    await runDunning(db())
    expect(captured.sent.filter((m) => m.to === 'dave@example.test')).toHaveLength(1)
    void before
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

/**
 * The sweep is global by design: one run acts on every past-due subscription in the
 * database. So one bad row must not stop it. This was found as a flaky test — about one
 * run in fourteen — where a parallel test file deleted its own past-due org while this
 * sweep was part-way through its snapshot. The update for the vanished row threw, the
 * whole run aborted, and every org after it in an unordered list was silently skipped.
 *
 * In production the same shape is a customer cancelling, or an org being deleted,
 * during the nightly run — and every overdue customer behind them in the list gets no
 * reminder and no suspension, with only a 500 in the cron log to say so.
 *
 * Reproduced deterministically here rather than left to timing.
 */
describe('one failing org does not stop the sweep', () => {
  const ours = randomUUID()
  const oursSite = randomUUID()
  const doomed = randomUUID()

  beforeEach(async () => {
    __useCapturingTransport()
    await rawPrisma.organizations.deleteMany({ where: { id: { in: [ours, doomed] } } })
    for (const [id, email] of [[ours, 'ours@example.test'], [doomed, 'gone@example.test']] as const) {
      const slug = `sweep-${id.slice(0, 8)}`
      await rawPrisma.organizations.create({ data: { id, name: slug, slug, billing_email: email } })
      await rawPrisma.subscriptions.create({ data: { org_id: id, plan_code: 'founding', status: 'past_due' } })
    }
    await rawPrisma.sites.create({
      data: { id: oursSite, org_id: ours, name: 'ours', slug: `sweep-s-${oursSite.slice(0, 8)}`, status: 'published' },
    })
    // Ours is due for suspension; the doomed one is due a reminder email, which is the
    // path that writes back to its subscription row.
    await rawPrisma.subscriptions.update({ where: { org_id: ours }, data: { updated_at: new Date(Date.now() - 14 * 864e5) } })
    await rawPrisma.subscriptions.update({ where: { org_id: doomed }, data: { updated_at: new Date(Date.now() - 2 * 864e5) } })
  })

  afterAll(async () => {
    await rawPrisma.organizations.deleteMany({ where: { id: { in: [ours, doomed] } } })
  })

  /**
   * A db whose snapshot puts the doomed org FIRST, and which deletes that org the
   * moment the sweep reaches it — exactly what a concurrent cancellation looks like.
   */
  function racingDb(): PrismaTx {
    const real = rawPrisma as unknown as PrismaTx
    const subs = new Proxy(real.subscriptions, {
      get(target, prop) {
        if (prop === 'findMany')
          return async (args: Parameters<typeof target.findMany>[0]) => {
            const rows = await target.findMany(args as never)
            const mine = rows.filter((r: { org_id: string }) => r.org_id === ours || r.org_id === doomed)
            return mine.sort((a: { org_id: string }) => (a.org_id === doomed ? -1 : 1))
          }
        if (prop === 'update')
          return async (args: { where: { org_id?: string } }) => {
            if (args.where.org_id === doomed) {
              await rawPrisma.organizations.deleteMany({ where: { id: doomed } })
            }
            return (target.update as (a: unknown) => unknown)(args)
          }
        return Reflect.get(target, prop)
      },
    })
    return new Proxy(real, { get: (t, p) => (p === 'subscriptions' ? subs : Reflect.get(t, p)) }) as PrismaTx
  }

  it('still suspends the org behind the one that failed', async () => {
    await runDunning(racingDb())
    const site = await rawPrisma.sites.findUnique({ where: { id: oursSite }, select: { status: true } })
    expect(site?.status).toBe('suspended')
  })

  it('counts the failure instead of hiding it', async () => {
    const run = await runDunning(racingDb())
    expect(run.failed).toBe(1)
    expect(run.suspended).toBe(1)
  })
})
