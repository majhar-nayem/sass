import { randomUUID, randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import type { PrismaTx } from '@awning/db'

/**
 * O-02 -- the operator console.
 *
 * Support at this price point means an operator sometimes has to see exactly what a
 * customer sees. Impersonation is the fastest way to do that and the most dangerous
 * thing in the codebase, so it is built with the constraints up front rather than
 * added after the first incident.
 */

/** Short on purpose: long enough to fix something, short enough not to be left open. */
const IMPERSONATION_MINUTES = 60

export interface AuditEntry {
  action: string
  actorUserId: string
  orgId?: string | undefined
  entityType?: string | undefined
  entityId?: string | undefined
  impersonatorId?: string | undefined
  metadata?: Record<string, unknown> | undefined
  ipHash?: string | undefined
  userAgent?: string | undefined
}

export async function audit(db: PrismaTx, entry: AuditEntry): Promise<void> {
  await db.audit_log.create({
    data: {
      action: entry.action,
      actor_user_id: entry.actorUserId,
      org_id: entry.orgId ?? null,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      impersonator_id: entry.impersonatorId ?? null,
      metadata: (entry.metadata ?? {}) as never,
      ip_hash: entry.ipHash ?? null,
      user_agent: entry.userAgent ?? null,
    },
  })
}

export class ImpersonationRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImpersonationRefused'
  }
}

export interface ImpersonationResult {
  token: string
  expiresAt: Date
  actingAs: { id: string; email: string; name: string | null }
}

/**
 * Starts an impersonated session.
 *
 * Three constraints, each of which exists because the alternative is worse:
 *
 *  - The audit row is written BEFORE the session, so a crash leaves a record of an
 *    attempt rather than an untraceable session.
 *  - A platform admin cannot impersonate another platform admin. Otherwise one
 *    compromised operator account reaches every operator account, and the audit trail
 *    stops meaning anything.
 *  - The session carries impersonated_by, so every action taken during it is
 *    attributable to the operator rather than appearing as the customer's own doing.
 */
export async function startImpersonation(
  db: PrismaTx,
  adminUserId: string,
  targetUserId: string,
  context: { ipHash?: string; userAgent?: string; reason?: string } = {},
): Promise<ImpersonationResult> {
  if (adminUserId === targetUserId)
    throw new ImpersonationRefused('You are already signed in as yourself.')

  const target = await db.users.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, is_platform_admin: true, deleted_at: true },
  })
  if (!target || target.deleted_at)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No such user.' })

  if (target.is_platform_admin)
    throw new ImpersonationRefused('Platform administrators cannot be impersonated.')

  await audit(db, {
    action: 'admin.impersonate',
    actorUserId: adminUserId,
    entityType: 'user',
    entityId: targetUserId,
    metadata: { email: target.email, reason: context.reason ?? null },
    ...(context.ipHash ? { ipHash: context.ipHash } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  })

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + IMPERSONATION_MINUTES * 60_000)

  await db.auth_sessions.create({
    data: {
      id: randomUUID(),
      user_id: targetUserId,
      token,
      expires_at: expiresAt,
      impersonated_by: adminUserId,
      ...(context.userAgent ? { user_agent: context.userAgent } : {}),
    },
  })

  return { token, expiresAt, actingAs: { id: target.id, email: target.email, name: target.name } }
}

export async function endImpersonation(db: PrismaTx, token: string): Promise<void> {
  const session = await db.auth_sessions.findFirst({
    where: { token },
    select: { id: true, user_id: true, impersonated_by: true },
  })
  if (!session?.impersonated_by) return

  await audit(db, {
    action: 'admin.impersonate.end',
    actorUserId: session.impersonated_by,
    entityType: 'user',
    entityId: session.user_id,
  })
  await db.auth_sessions.delete({ where: { id: session.id } })
}

/** Operator overview: the orgs, what they are on, and whether they are stuck. */
export async function listOrgs(db: PrismaTx, opts: { search?: string; limit?: number } = {}) {
  const search = opts.search?.trim()
  return db.organizations.findMany({
    where: {
      deleted_at: null,
      ...(search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { slug: { contains: search.toLowerCase() } }] }
        : {}),
    },
    orderBy: { created_at: 'desc' },
    take: opts.limit ?? 50,
    select: {
      id: true,
      name: true,
      slug: true,
      created_at: true,
      onboarding_completed_at: true,
      subscriptions: { select: { status: true, plan_code: true } },
      sites: { select: { id: true, status: true, published_at: true } },
      memberships: { select: { users: { select: { id: true, email: true } } }, take: 1 },
    },
  })
}

/**
 * Grants extra AI actions for the current period.
 *
 * A bonus on the subscription, not an edit to the plan: a plan row is shared by every
 * org on it, so "give this customer 50 more" via the plan silently gives 50 more to
 * everyone. The grant expires with the billing period so it does not become permanent
 * by accident.
 */
export async function grantAiCredit(
  db: PrismaTx,
  adminUserId: string,
  orgId: string,
  actions: number,
  reason: string,
): Promise<{ bonus: number; expiresAt: Date }> {
  if (!Number.isInteger(actions) || actions < 1 || actions > 1000)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Grant between 1 and 1000 actions.' })
  if (!reason.trim())
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Say why — it goes in the audit log.' })

  const sub = await db.subscriptions.findUnique({
    where: { org_id: orgId },
    select: { ai_actions_bonus: true, ai_bonus_expires_at: true, current_period_end: true },
  })
  if (!sub) throw new TRPCError({ code: 'NOT_FOUND' })

  // A stale bonus from a previous period is replaced, not added to.
  const expired = !sub.ai_bonus_expires_at || sub.ai_bonus_expires_at < new Date()
  const bonus = (expired ? 0 : sub.ai_actions_bonus) + actions
  const expiresAt =
    sub.current_period_end ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))

  await db.subscriptions.update({
    where: { org_id: orgId },
    data: { ai_actions_bonus: bonus, ai_bonus_expires_at: expiresAt },
  })

  await audit(db, {
    action: 'admin.grant_ai_credit',
    actorUserId: adminUserId,
    orgId,
    metadata: { actions, bonus, reason },
  })

  return { bonus, expiresAt }
}

/** The audit trail for one org, for answering "who changed that". */
export async function auditTrail(db: PrismaTx, orgId: string, limit = 100) {
  return db.audit_log.findMany({
    where: { org_id: orgId },
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true, action: true, actor_user_id: true, impersonator_id: true,
      entity_type: true, entity_id: true, metadata: true, created_at: true,
    },
  })
}

/**
 * O-05b -- taking a site down for an Acceptable Use Policy breach.
 *
 * Separate from dunning suspension, which is about money and reverses itself the
 * moment an invoice is paid. This one is a judgement call by a person, so it records
 * who made it and why: the AUP promises the customer a record of what was removed and
 * on what grounds, and that promise needs somewhere to read it from.
 *
 * Deliberately does NOT delete anything. A wrong takedown must be reversible, and
 * evidence has to survive the incident.
 */
export async function suspendForAup(
  db: PrismaTx,
  adminUserId: string,
  siteId: string,
  reason: string,
  opts: { immediate?: boolean } = {},
): Promise<{ siteId: string; orgId: string }> {
  if (reason.trim().length < 20)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Give the actual reason — the customer is entitled to it and it goes in the audit log.',
    })

  const site = await db.sites.findUnique({ where: { id: siteId }, select: { id: true, org_id: true, status: true } })
  if (!site) throw new TRPCError({ code: 'NOT_FOUND' })

  await db.sites.update({
    where: { id: siteId },
    // The cache epoch bump is what makes it disappear now rather than in five minutes.
    data: { status: 'suspended', cache_epoch: { increment: 1 } },
  })

  await audit(db, {
    action: 'admin.aup_suspend',
    actorUserId: adminUserId,
    orgId: site.org_id,
    entityType: 'site',
    entityId: siteId,
    metadata: { reason, immediate: opts.immediate ?? false, previousStatus: site.status },
  })

  return { siteId, orgId: site.org_id }
}

/** Putting it back, with the same accountability as taking it down. */
export async function restoreAfterAup(
  db: PrismaTx,
  adminUserId: string,
  siteId: string,
  reason: string,
): Promise<void> {
  const site = await db.sites.findUnique({
    where: { id: siteId },
    select: { org_id: true, published_version_id: true },
  })
  if (!site) throw new TRPCError({ code: 'NOT_FOUND' })

  await db.sites.update({
    where: { id: siteId },
    // Only back to published if there is something to publish; otherwise it is a draft.
    data: {
      status: site.published_version_id ? 'published' : 'draft',
      cache_epoch: { increment: 1 },
    },
  })

  await audit(db, {
    action: 'admin.aup_restore',
    actorUserId: adminUserId,
    orgId: site.org_id,
    entityType: 'site',
    entityId: siteId,
    metadata: { reason },
  })
}
