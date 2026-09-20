import type { PrismaTx } from '@awning/db'
import { sendMail } from '@awning/integrations/mail'

/**
 * O-03 -- dunning.
 *
 * Expired cards are the largest single cause of involuntary churn at A$39/month, and the
 * instinct to protect revenue by switching the site off on day one is exactly wrong: a
 * tradie whose website disappears because their card expired does not come back, and
 * does tell other tradies. Seven days of email, then a banner only the owner sees, then
 * suspension at fourteen.
 *
 * The decision is a pure function so the whole schedule can be tested without a clock,
 * a mailbox or a database.
 */
export type DunningAction =
  | { action: 'none' }
  | { action: 'email'; day: 1 | 3 | 7; subject: string; body: string }
  | { action: 'suspend' }

export interface DunningState {
  /** Days since the subscription went past_due. */
  daysPastDue: number
  /** Which reminder days have already gone out, so a re-run does not resend. */
  emailsSent: number[]
  siteName: string
  manageUrl: string
}

export const GRACE_DAYS = 14
const SCHEDULE = [1, 3, 7] as const

export function decideDunning(s: DunningState): DunningAction {
  if (s.daysPastDue >= GRACE_DAYS) return { action: 'suspend' }

  // Latest due reminder that has not been sent. Catching up matters: if the cron misses
  // a day, the owner should still get day 3 rather than silently skipping to day 7.
  const due = SCHEDULE.filter((d) => s.daysPastDue >= d && !s.emailsSent.includes(d))
  const day = due.at(-1)
  if (!day) return { action: 'none' }

  return { action: 'email', day, ...copyFor(day, s) }
}

function copyFor(day: 1 | 3 | 7, s: DunningState): { subject: string; body: string } {
  const left = GRACE_DAYS - day
  if (day === 1)
    return {
      subject: `Your payment for ${s.siteName} didn't go through`,
      body: [
        `Hi,`,
        ``,
        `The card on your Awning account was declined, so this month's payment didn't go through.`,
        ``,
        `Your website is still live and nothing has changed. You can update your card here:`,
        s.manageUrl,
        ``,
        `If the card is fine and this is a mistake, it'll sort itself out on the next attempt.`,
      ].join('\n'),
    }
  if (day === 3)
    return {
      subject: `Reminder: payment for ${s.siteName}`,
      body: [
        `Hi,`,
        ``,
        `We still haven't been able to take payment for your website. It's still live — this is just a nudge.`,
        ``,
        s.manageUrl,
        ``,
        `Any trouble, just reply to this email.`,
      ].join('\n'),
    }
  return {
    subject: `Action needed: ${s.siteName} goes offline in ${left} days`,
    // The first message that says what will actually happen, and when. Saying it
    // earlier would be a threat; saying it later would be a surprise.
    body: [
      `Hi,`,
      ``,
      `We haven't been able to take payment for your website for a week now.`,
      ``,
      `It's still live, but if we can't take payment in the next ${left} days it will go offline.`,
      `Updating your card takes a minute:`,
      s.manageUrl,
      ``,
      `If you'd rather cancel, reply and tell us — we'll sort it out and you won't be charged.`,
    ].join('\n'),
  }
}

export interface DunningRun {
  considered: number
  emailed: number
  suspended: number
}

/**
 * Called daily by the cron route.
 *
 * Suspension sets the site status; the renderer already answers 404 for a suspended
 * host, and the owner keeps full access to the dashboard so they can pay and bring it
 * back themselves.
 */
export async function runDunning(db: PrismaTx, now = new Date()): Promise<DunningRun> {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

  const overdue = await db.subscriptions.findMany({
    where: { status: 'past_due' },
    select: {
      org_id: true,
      updated_at: true,
      dunning_emails_sent: true,
      organizations: {
        select: {
          name: true,
          billing_email: true,
          sites: { select: { id: true, name: true, status: true } },
        },
      },
    },
  })

  const run: DunningRun = { considered: overdue.length, emailed: 0, suspended: 0 }

  for (const sub of overdue) {
    const org = sub.organizations
    const site = org.sites[0]
    const daysPastDue = Math.floor((now.getTime() - sub.updated_at.getTime()) / 864e5)

    const decision = decideDunning({
      daysPastDue,
      emailsSent: (sub.dunning_emails_sent as number[] | null) ?? [],
      siteName: site?.name ?? org.name,
      manageUrl: `${appUrl}/billing`,
    })

    if (decision.action === 'suspend') {
      await db.sites.updateMany({
        where: { org_id: sub.org_id, status: 'published' },
        data: { status: 'suspended', cache_epoch: { increment: 1 } },
      })
      run.suspended++
      continue
    }

    if (decision.action === 'email') {
      if (org.billing_email)
        await sendMail({
          to: org.billing_email,
          subject: decision.subject,
          text: decision.body,
          kind: 'platform',
        })
      // Recorded whether or not the send succeeded: a bounced address must not cause
      // the same reminder to be retried every hour forever.
      await db.subscriptions.update({
        where: { org_id: sub.org_id },
        data: {
          dunning_emails_sent: [
            ...(((sub.dunning_emails_sent as number[] | null) ?? []) as number[]),
            decision.day,
          ],
        },
      })
      run.emailed++
    }
  }

  return run
}

/** Brings a site back the moment payment succeeds. */
export async function restoreAfterPayment(db: PrismaTx, orgId: string): Promise<number> {
  const { count } = await db.sites.updateMany({
    where: { org_id: orgId, status: 'suspended' },
    data: { status: 'published', cache_epoch: { increment: 1 } },
  })
  await db.subscriptions.update({
    where: { org_id: orgId },
    data: { dunning_emails_sent: [] },
  })
  return count
}
