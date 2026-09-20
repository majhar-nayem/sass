import { randomUUID } from 'node:crypto'
import { rawPrisma, withOrgContext } from '@awning/db'
import { allocateSubdomain } from '@awning/tenancy'

export type MemberRole = 'owner' | 'admin' | 'staff'

/** Roles that may change billing, delete the site, or remove other people. */
const PRIVILEGED: MemberRole[] = ['owner', 'admin']

export interface Membership {
  orgId: string
  userId: string
  role: MemberRole
}

/**
 * Resolves which org a request acts on.
 *
 * Deliberately takes the org from the user's memberships, never from the client. A
 * request that could name its own org id would make every downstream permission check
 * decorative -- this is the choke point the whole isolation model rests on.
 */
export async function membershipFor(userId: string, orgId?: string): Promise<Membership | null> {
  const rows = await rawPrisma.memberships.findMany({
    where: { user_id: userId, ...(orgId ? { org_id: orgId } : {}) },
    select: { org_id: true, user_id: true, role: true },
    orderBy: { created_at: 'asc' },
  })
  const row = rows[0]
  if (!row) return null
  return { orgId: row.org_id, userId: row.user_id, role: row.role as MemberRole }
}

export function canManage(role: MemberRole): boolean {
  return PRIVILEGED.includes(role)
}

export class NotAMemberError extends Error {
  constructor() {
    super('You are not a member of this organisation.')
    this.name = 'NotAMemberError'
  }
}

/**
 * Creates the org, its first site and its subdomain in one transaction.
 *
 * All of it or none of it: a half-created org with no site is a support ticket during
 * signup, which is the worst possible moment to have one.
 */
export async function createOrgForUser(input: {
  userId: string
  businessName: string
  state?: string
  abn?: string
  industry?: string
}): Promise<{ orgId: string; siteId: string; subdomain: string }> {
  const root = process.env.SITES_ROOT_DOMAIN ?? 'awningsites.com'

  const subdomain = await allocateSubdomain(input.businessName, async (label) => {
    const clash = await rawPrisma.sites.findFirst({ where: { slug: label }, select: { id: true } })
    return clash !== null
  })

  const orgId = randomUUID()
  const siteId = randomUUID()

  await rawPrisma.$transaction(async (tx) => {
    await tx.organizations.create({
      data: {
        id: orgId,
        name: input.businessName,
        slug: subdomain,
        state: input.state ?? null,
        abn: input.abn ?? null,
      },
    })
    await tx.memberships.create({ data: { org_id: orgId, user_id: input.userId, role: 'owner' } })
    await tx.sites.create({
      data: {
        id: siteId,
        org_id: orgId,
        name: input.businessName,
        slug: subdomain,
        industry: input.industry ?? null,
        status: 'draft',
      },
    })
    /**
     * A trial subscription, created with the org.
     *
     * Without this every new org fails checkQuota with 'no_subscription' and can never
     * use the AI at all — which the template fallback quietly covered for. The trial is
     * the funnel: generating and previewing are free, and publishing is what asks for a
     * card (docs/06-COMMERCE-BILLING.md §2).
     */
    await tx.subscriptions.create({
      data: {
        org_id: orgId,
        plan_code: 'founding',
        status: 'trialing',
        trial_ends_at: new Date(Date.now() + 14 * 864e5),
      },
    })
    await tx.site_domains.create({
      data: {
        site_id: siteId,
        hostname: `${subdomain}.${root}`,
        kind: 'subdomain',
        status: 'active',
        is_primary: true,
        activated_at: new Date(),
      },
    })
  })

  return { orgId, siteId, subdomain }
}

/** Convenience wrapper so callers do not repeat the membership check. */
export async function asOrg<T>(
  userId: string,
  orgId: string,
  fn: Parameters<typeof withOrgContext<T>>[1],
): Promise<T> {
  const m = await membershipFor(userId, orgId)
  if (!m) throw new NotAMemberError()
  return withOrgContext(m.orgId, fn)
}
