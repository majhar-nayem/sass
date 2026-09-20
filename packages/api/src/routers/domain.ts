import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { invalidateTenant } from '@awning/tenancy'
import { adminProcedure, orgProcedure, platformProcedure, router, type OrgContext } from '../trpc.js'
import { attachDomain, checkDomain, detachDomain, DomainRejected, sweepDomains } from '../domains.js'

const asTrpc = (e: unknown): never => {
  if (e instanceof DomainRejected) throw new TRPCError({ code: 'BAD_REQUEST', message: e.message })
  throw e
}

export const domainRouter = router({
  list: orgProcedure.input(z.object({ siteId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    return c.db.site_domains.findMany({
      where: { site_id: input.siteId, status: { not: 'detached' } },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      select: {
        id: true, hostname: true, kind: true, status: true, is_primary: true,
        error_message_human: true, verification_txt: true, activated_at: true,
      },
    })
  }),

  /**
   * O-01 -- concierge attach.
   *
   * Admin-gated rather than open to staff: pointing a business's domain at the wrong
   * site takes their website off the internet, which is not an undo-able mistake.
   */
  attach: adminProcedure
    .input(z.object({ siteId: z.string().uuid(), hostname: z.string().min(3).max(253), primary: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const site = await c.db.sites.findUnique({ where: { id: input.siteId }, select: { id: true } })
      if (!site) throw new TRPCError({ code: 'NOT_FOUND' })

      try {
        const result = await attachDomain(c.db, input.siteId, input.hostname, { primary: input.primary })
        if (input.primary)
          await c.db.site_domains.updateMany({
            where: { site_id: input.siteId, hostname: { not: result.hostname } },
            data: { is_primary: false },
          })
        await invalidateTenant(result.hostname)
        return result
      } catch (e) {
        return asTrpc(e)
      }
    }),

  check: adminProcedure
    .input(z.object({ domainId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const row = await c.db.site_domains.findUnique({
        where: { id: input.domainId },
        select: { hostname: true },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      const result = await checkDomain(c.db, input.domainId)
      // The resolver caches by hostname; without this a newly active domain still 404s.
      await invalidateTenant(row.hostname)
      return result
    }),

  detach: adminProcedure
    .input(z.object({ domainId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const row = await c.db.site_domains.findUnique({
        where: { id: input.domainId },
        select: { hostname: true },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      await detachDomain(c.db, input.domainId)
      await invalidateTenant(row.hostname)
      return { ok: true }
    }),

  /** Operator-only: the same sweep the cron runs, for when someone is waiting on the phone. */
  sweep: platformProcedure.mutation(async () => {
    const { withoutOrgContext } = await import('@awning/db')
    return withoutOrgContext('cron', (db) => sweepDomains(db))
  }),
})
