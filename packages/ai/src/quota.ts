import { withoutOrgContext } from '@awning/db'

/**
 * A-07 -- four independent layers of spend control.
 *
 * These exist for the pathological case, not the typical one. A typical customer costs
 * well under A$2/month in model calls; the point of this file is that a bug, a loop or
 * an abusive signup cannot turn that into a four-figure invoice overnight. It is built
 * before the first customer on purpose: every one of these is cheap now and is only ever
 * written after an incident otherwise.
 */

export type DenialReason =
  | 'quota_exhausted'
  | 'org_spend_cap'
  | 'rate_limited'
  | 'platform_circuit_open'
  | 'no_subscription'

export interface QuotaDecision {
  allowed: boolean
  reason?: DenialReason
  /** Written for the owner, not for a log. */
  message?: string
  used: number
  limit: number
  spentCents: number
  capCents: number
}

export class AiDenied extends Error {
  constructor(
    readonly reason: DenialReason,
    message: string,
  ) {
    super(message)
    this.name = 'AiDenied'
  }
}

const PLATFORM_DAILY_CEILING_CENTS = Number(process.env.AI_DAILY_CEILING_CENTS ?? 4000)

/** Sliding-window counters. In-process is correct here: Fly runs few app machines and
 *  the DB caps below are the real backstop — this layer only blunts bursts. */
const recent = new Map<string, number[]>()
const RATE_PER_MINUTE = 8
const RATE_PER_HOUR = 40

function rateLimited(orgId: string, now = Date.now()): boolean {
  const hits = (recent.get(orgId) ?? []).filter((t) => now - t < 3_600_000)
  const lastMinute = hits.filter((t) => now - t < 60_000)
  if (lastMinute.length >= RATE_PER_MINUTE || hits.length >= RATE_PER_HOUR) {
    recent.set(orgId, hits)
    return true
  }
  hits.push(now)
  recent.set(orgId, hits)
  return false
}

export function __resetRateLimiter(): void {
  recent.clear()
}

function periodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * Checked before every model call. Reads the plan's limits rather than hardcoding them,
 * so changing a plan is a row update.
 */
export async function checkQuota(
  orgId: string,
  opts: { now?: Date; skipRateLimit?: boolean } = {},
): Promise<QuotaDecision> {
  const now = opts.now ?? new Date()

  return withoutOrgContext('cron', async (db) => {
    const sub = await db.subscriptions.findUnique({
      where: { org_id: orgId },
      select: { status: true, plans: { select: { ai_actions_month: true, ai_hard_cap_cents: true } } },
    })

    // Trialing counts: the whole funnel depends on generating before they pay.
    const plan = sub?.plans
    if (!plan)
      return {
        allowed: false,
        reason: 'no_subscription' as const,
        message: 'Pick a plan to start building your site.',
        used: 0,
        limit: 0,
        spentCents: 0,
        capCents: 0,
      }

    const since = periodStart(now)
    const rows = await db.ai_usage.aggregate({
      where: { org_id: orgId, created_at: { gte: since }, counts_to_quota: true },
      _count: { _all: true },
      _sum: { cost_cents_aud: true },
    })

    const used = rows._count._all
    const spentCents = Number(rows._sum.cost_cents_aud ?? 0)
    const limit = plan.ai_actions_month
    const capCents = plan.ai_hard_cap_cents

    const base = { used, limit, spentCents, capCents }

    // 1. Platform circuit breaker. The one that saves you at 3am: it is global, so a
    //    single runaway org cannot spend the month's budget while nobody is awake.
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const today = await db.ai_usage.aggregate({
      where: { created_at: { gte: todayStart } },
      _sum: { cost_cents_aud: true },
    })
    if (Number(today._sum.cost_cents_aud ?? 0) >= PLATFORM_DAILY_CEILING_CENTS)
      return {
        ...base,
        allowed: false,
        reason: 'platform_circuit_open',
        message: 'We are catching up on a backlog of requests. Please try again shortly.',
      }

    // 2. Per-org dollar cap. Catches a loop that stays inside its action quota because
    //    each call is small — quota alone would never trip.
    if (spentCents >= capCents)
      return {
        ...base,
        allowed: false,
        reason: 'org_spend_cap',
        message: "You've hit this month's AI limit. Get in touch and we'll sort it out.",
      }

    // 3. Plan quota. Offers a top-up rather than a wall: a hard stop on a paying
    //    customer mid-edit is a churn event, and 50 more actions cost us about 20c.
    if (used >= limit)
      return {
        ...base,
        allowed: false,
        reason: 'quota_exhausted',
        message: `You've used your ${limit} AI changes for this month. You can top up 50 more for $9, or they reset on the 1st.`,
      }

    // 4. Rate limit. Blocks scripted abuse and accidental double-submits.
    if (!opts.skipRateLimit && rateLimited(orgId, now.getTime()))
      return {
        ...base,
        allowed: false,
        reason: 'rate_limited',
        message: "That's a lot of changes at once — give it a few seconds and try again.",
      }

    return { ...base, allowed: true }
  })
}

/** Platform spend today, for the ops digest and the alert. */
export async function platformSpendTodayCents(now = new Date()): Promise<number> {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return withoutOrgContext('cron', async (db) => {
    const r = await db.ai_usage.aggregate({
      where: { created_at: { gte: todayStart } },
      _sum: { cost_cents_aud: true },
    })
    return Number(r._sum.cost_cents_aud ?? 0)
  })
}

export const PLATFORM_DAILY_CEILING = PLATFORM_DAILY_CEILING_CENTS
