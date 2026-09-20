import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { invalidateTenant } from '@awning/tenancy'
import { validateSpec } from '@awning/spec'
import { canPublish } from '@awning/integrations/stripe'
import { adminProcedure, orgProcedure, router, type OrgContext } from '../trpc.js'

const siteId = z.object({ siteId: z.string().uuid() })

/**
 * Every handler below queries through ctx.db, which is already scoped to the caller's
 * org by RLS. The `where` clauses are for correctness and index use, not for security --
 * that is the point of orgProcedure. The isolation matrix in
 * __tests__/isolation-matrix.test.ts proves it by asking for another org's ids directly.
 */
export const siteRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    const c = ctx as unknown as OrgContext
    return c.db.sites.findMany({
      where: { deleted_at: null },
      select: { id: true, name: true, slug: true, status: true, published_at: true },
      orderBy: { created_at: 'asc' },
    })
  }),

  get: orgProcedure.input(siteId).query(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    const site = await c.db.sites.findUnique({ where: { id: input.siteId } })
    if (!site) throw new TRPCError({ code: 'NOT_FOUND' })
    return site
  }),

  update: orgProcedure
    .input(
      siteId.extend({
        name: z.string().min(1).max(80).optional(),
        business_phone: z.string().max(30).nullable().optional(),
        business_email: z.string().email().nullable().optional(),
        seo_title: z.string().max(70).nullable().optional(),
        seo_description: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const { siteId: id, ...data } = input
      const n = await c.db.sites.updateMany({ where: { id }, data })
      if (n.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true }
    }),

  listVersions: orgProcedure.input(siteId).query(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    return c.db.site_versions.findMany({
      where: { site_id: input.siteId },
      select: { id: true, version: true, summary: true, created_by: true, created_at: true },
      orderBy: { version: 'desc' },
      take: 50,
    })
  }),

  /**
   * Publishing is a pointer move plus a cache bump -- no build, no deploy
   * (docs/02-ARCHITECTURE.md §4). The spec is re-validated first: it was valid when it
   * was written, but the schema may have moved since, and a spec that no longer
   * validates must never become the live version of someone's business website.
   */
  publish: adminProcedure.input(siteId).mutation(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext

    /**
     * M-02 -- publishing is the paywall, not generating.
     *
     * A trial can build, edit and preview as much as it likes. The card is asked for at
     * the moment the owner wants the site live, which is the moment they have already
     * decided it is worth something. Asking earlier converts far worse.
     */
    const sub = await c.db.subscriptions.findUnique({
      where: { org_id: c.membership.orgId },
      select: { status: true },
    })
    if (!sub || !canPublish(sub.status))
      throw new TRPCError({
        code: 'PAYMENT_REQUIRED',
        message:
          sub?.status === 'trialing'
            ? 'Your site is ready to go live — choose a plan to publish it.'
            : 'Your subscription is not active. Update your billing to publish.',
      })

    const site = await c.db.sites.findUnique({
      where: { id: input.siteId },
      select: { id: true, draft_version_id: true, first_published_at: true },
    })
    if (!site) throw new TRPCError({ code: 'NOT_FOUND' })
    if (!site.draft_version_id)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'There is nothing to publish yet.' })

    const draft = await c.db.site_versions.findUnique({
      where: { id: site.draft_version_id },
      select: { spec_json: true },
    })
    const check = validateSpec(draft?.spec_json)
    if (!check.ok)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `This draft can't be published yet: ${check.errors[0]?.message ?? 'it failed validation'}`,
      })

    const now = new Date()
    await c.db.sites.update({
      where: { id: site.id },
      data: {
        published_version_id: site.draft_version_id,
        status: 'published',
        published_at: now,
        first_published_at: site.first_published_at ?? now,
        cache_epoch: { increment: 1 },
      },
    })

    // Without this the owner publishes and sees no change for up to five minutes.
    const hosts = await c.db.site_domains.findMany({
      where: { site_id: site.id },
      select: { hostname: true },
    })
    await invalidateTenant(...hosts.map((h) => h.hostname))

    return { ok: true, publishedAt: now }
  }),

  unpublish: adminProcedure.input(siteId).mutation(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    const n = await c.db.sites.updateMany({
      where: { id: input.siteId },
      data: { status: 'unpublished', cache_epoch: { increment: 1 } },
    })
    if (n.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
    const hosts = await c.db.site_domains.findMany({
      where: { site_id: input.siteId },
      select: { hostname: true },
    })
    await invalidateTenant(...hosts.map((h) => h.hostname))
    return { ok: true }
  }),
})
