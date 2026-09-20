import type { PrismaTx } from '@awning/db'
import { sendMail } from '@awning/integrations/mail'
import { PLATFORM_DAILY_CEILING } from '@awning/ai'

/**
 * O-04 -- monitoring.
 *
 * Five minutes over coffee rather than a dashboard nobody opens. The daily digest is
 * the whole of the monitoring story at this size: one email that says what happened and
 * what is stuck, with the numbers that would otherwise only be noticed when a customer
 * complains or an invoice arrives.
 */
export interface DigestData {
  date: string
  signups: number
  published: number
  activeCustomers: number
  mrrCents: number
  aiSpendCents: number
  aiSpendCeilingCents: number
  aiFailureRate: number
  enquiries: number
  enquiriesNotEmailed: number
  domainsStuck: Array<{ hostname: string; status: string; hoursWaiting: number; problem: string | null }>
  pastDue: number
  suspended: number
  brokenSites: number
}

export async function collectDigest(db: PrismaTx, now = new Date()): Promise<DigestData> {
  const since = new Date(now.getTime() - 864e5)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const [signups, published, subs, aiRows, aiFails, enquiries, notEmailed, stuck, suspended, broken] =
    await Promise.all([
      db.organizations.count({ where: { created_at: { gte: since } } }),
      db.sites.count({ where: { first_published_at: { gte: since } } }),
      db.subscriptions.findMany({
        where: { status: { in: ['active', 'past_due'] } },
        select: { status: true, price_locked_cents: true, plans: { select: { price_cents_aud: true } } },
      }),
      db.ai_usage.aggregate({
        where: { created_at: { gte: todayStart } },
        _sum: { cost_cents_aud: true },
        _count: { _all: true },
      }),
      db.ai_usage.count({ where: { created_at: { gte: todayStart }, success: false } }),
      db.form_submissions.count({ where: { created_at: { gte: since }, is_spam: false } }),
      db.form_submissions.count({
        where: { created_at: { gte: since }, is_spam: false, notified_at: null },
      }),
      db.site_domains.findMany({
        where: {
          kind: 'custom',
          status: { in: ['pending', 'verifying', 'ssl_pending', 'failed'] },
          created_at: { lt: new Date(now.getTime() - 24 * 3600_000) },
        },
        select: { hostname: true, status: true, created_at: true, error_message_human: true },
        take: 20,
      }),
      db.sites.count({ where: { status: 'suspended' } }),
      // A published site whose spec no longer validates renders a 500 for real
      // visitors. Counted here because nobody would otherwise notice until a customer
      // rang up.
      db.sites.count({ where: { status: 'published', published_version_id: null } }),
    ])

  const total = aiRows._count._all || 0
  void monthStart

  return {
    date: now.toISOString().slice(0, 10),
    signups,
    published,
    activeCustomers: subs.filter((s) => s.status === 'active').length,
    mrrCents: subs.reduce((n, s) => n + (s.price_locked_cents ?? s.plans.price_cents_aud), 0),
    aiSpendCents: Math.round(Number(aiRows._sum.cost_cents_aud ?? 0)),
    aiSpendCeilingCents: PLATFORM_DAILY_CEILING,
    aiFailureRate: total === 0 ? 0 : aiFails / total,
    enquiries,
    enquiriesNotEmailed: notEmailed,
    domainsStuck: stuck.map((d) => ({
      hostname: d.hostname,
      status: d.status,
      hoursWaiting: Math.round((now.getTime() - d.created_at.getTime()) / 3600_000),
      problem: d.error_message_human,
    })),
    pastDue: subs.filter((s) => s.status === 'past_due').length,
    suspended,
    brokenSites: broken,
  }
}

const money = (cents: number) => `A$${(cents / 100).toFixed(2)}`

/**
 * Things worth waking up for, listed before the numbers.
 *
 * Deliberately short. A digest that flags six things every morning trains you to skim
 * it, and then the one that matters goes past unread.
 */
export function digestAlerts(d: DigestData): string[] {
  const alerts: string[] = []
  if (d.aiSpendCents >= d.aiSpendCeilingCents * 0.8)
    alerts.push(`AI spend ${money(d.aiSpendCents)} of ${money(d.aiSpendCeilingCents)} daily ceiling`)
  if (d.aiFailureRate > 0.08)
    alerts.push(`AI failure rate ${(d.aiFailureRate * 100).toFixed(0)}% — the prompt or the schema has drifted`)
  // The one that costs a customer directly: their lead exists and they never heard.
  if (d.enquiriesNotEmailed > 0)
    alerts.push(`${d.enquiriesNotEmailed} enquiries saved but NOT emailed to the owner`)
  if (d.brokenSites > 0) alerts.push(`${d.brokenSites} published sites have no published version`)
  if (d.domainsStuck.length > 0)
    alerts.push(`${d.domainsStuck.length} custom domains stuck over 24h`)
  return alerts
}

export function renderDigest(d: DigestData): { subject: string; text: string } {
  const alerts = digestAlerts(d)
  const lines = [
    `Awning — ${d.date}`,
    '',
    ...(alerts.length ? ['NEEDS ATTENTION', ...alerts.map((a) => `  - ${a}`), ''] : []),
    `Yesterday`,
    `  signups            ${d.signups}`,
    `  sites published    ${d.published}`,
    `  enquiries          ${d.enquiries}`,
    '',
    `Business`,
    `  paying customers   ${d.activeCustomers}`,
    `  MRR                ${money(d.mrrCents)}`,
    `  past due           ${d.pastDue}`,
    `  suspended          ${d.suspended}`,
    '',
    `Costs today`,
    `  AI spend           ${money(d.aiSpendCents)} of ${money(d.aiSpendCeilingCents)}`,
    `  AI failures        ${(d.aiFailureRate * 100).toFixed(1)}%`,
  ]

  if (d.domainsStuck.length)
    lines.push(
      '',
      'Domains waiting',
      ...d.domainsStuck.map(
        (x) => `  ${x.hostname} — ${x.status}, ${x.hoursWaiting}h${x.problem ? ` — ${x.problem}` : ''}`,
      ),
    )

  return {
    // The subject alone should be enough on a phone: no alerts means no need to open it.
    subject: alerts.length ? `Awning: ${alerts.length} to look at — ${d.date}` : `Awning: all good — ${d.date}`,
    text: lines.join('\n'),
  }
}

export async function sendDigest(db: PrismaTx, now = new Date()): Promise<DigestData> {
  const data = await collectDigest(db, now)
  const to = process.env.OPS_EMAIL
  if (to) {
    const { subject, text } = renderDigest(data)
    await sendMail({ to, subject, text, kind: 'platform' })
  }
  return data
}

/**
 * The canary: real tenant hostnames, fetched the way a visitor would.
 *
 * Checking /api/health only proves the process is up. When the renderer is broken, every
 * customer's website is broken at once — that is the multi-tenant trade — so the check
 * has to be an actual published page.
 */
export interface CanaryResult {
  hostname: string
  ok: boolean
  status: number
  ms: number
}

export async function runCanaries(db: PrismaTx, baseUrl?: string): Promise<CanaryResult[]> {
  const hosts = await db.site_domains.findMany({
    where: { status: 'active', sites: { status: 'published' } },
    orderBy: { activated_at: 'asc' },
    take: 3,
    select: { hostname: true },
  })

  return Promise.all(
    hosts.map(async ({ hostname }) => {
      const started = Date.now()
      try {
        const res = await fetch(baseUrl ?? `https://${hostname}`, {
          headers: baseUrl ? { Host: hostname } : {},
          signal: AbortSignal.timeout(10_000),
        })
        return { hostname, ok: res.ok, status: res.status, ms: Date.now() - started }
      } catch {
        return { hostname, ok: false, status: 0, ms: Date.now() - started }
      }
    }),
  )
}
