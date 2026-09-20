import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { AiDenied, checkQuota, editSite, summariseChanges } from '@awning/ai'
import {
  replaceImage,
  reorderSections,
  setTextAtPath,
  setTheme,
  toggleSection,
  validateSpec,
} from '@awning/spec'
import { orgProcedure, router, type OrgContext } from '../trpc.js'
import { currentDraftSpec, restoreVersion, undoLastChange, writeVersion } from '../versions.js'

const siteInput = z.object({ siteId: z.string().uuid() })

async function loadDraft(c: OrgContext, siteId: string) {
  const spec = await currentDraftSpec(c.db, siteId)
  if (!spec)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'This site has no draft to edit yet.' })
  return spec
}

/**
 * A-11 -- the deterministic fast path.
 *
 * These are the edits the editor UI already knows precisely: someone clicked a heading
 * and retyped it, moved a colour picker, dragged a section, toggled one off. Around a
 * third of all edit turns are this shape.
 *
 * Routing them through a model would be slower, cost money and be less reliable — the
 * model's best possible output is exactly what the user already typed. They still write
 * a version, so undo works identically whether a change came from chat or from a drag.
 */
const fastPath = {
  setText: orgProcedure
    .input(siteInput.extend({ sectionId: z.string(), path: z.string().max(80), value: z.string().max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const spec = await loadDraft(c, input.siteId)
      const next = setTextAtPath(spec, input.sectionId, input.path, input.value)
      return persist(c, input.siteId, next, 'Edited text')
    }),

  setThemeColour: orgProcedure
    .input(
      siteInput.extend({
        key: z.enum(['primary', 'secondary', 'accent', 'neutral', 'surface']),
        value: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const spec = await loadDraft(c, input.siteId)
      const next = setTheme(spec, { [input.key]: input.value })
      return persist(c, input.siteId, next, 'Changed a colour')
    }),

  toggleSection: orgProcedure
    .input(siteInput.extend({ sectionId: z.string(), hidden: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const spec = await loadDraft(c, input.siteId)
      const next = toggleSection(spec, input.sectionId, input.hidden)
      return persist(c, input.siteId, next, input.hidden ? 'Hid a section' : 'Showed a section')
    }),

  reorderSections: orgProcedure
    .input(siteInput.extend({ pageId: z.string(), sectionIds: z.array(z.string()).min(1).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const spec = await loadDraft(c, input.siteId)
      const next = reorderSections(spec, input.pageId, input.sectionIds)
      return persist(c, input.siteId, next, 'Reordered the sections')
    }),

  replaceImage: orgProcedure
    .input(
      siteInput.extend({
        sectionId: z.string(),
        path: z.string().max(80),
        assetId: z.string(),
        alt: z.string().max(140).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const spec = await loadDraft(c, input.siteId)
      const next = replaceImage(spec, input.sectionId, input.path, input.assetId, input.alt)
      return persist(c, input.siteId, next, 'Replaced an image')
    }),
}

/** Validate then write. A direct manipulation can still produce an invalid document —
 *  a cleared heading, an image with no alt text — and must be refused like any other. */
async function persist(c: OrgContext, siteId: string, spec: unknown, summary: string) {
  const check = validateSpec(spec)
  if (!check.ok)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: check.errors[0]?.message ?? 'That change would break the site.',
    })
  const version = await writeVersion(c.db, {
    siteId,
    spec: check.spec,
    summary,
    createdBy: 'user',
    createdByUser: c.userId,
  })
  return { ok: true as const, version, spec: check.spec }
}

export const aiRouter = router({
  /** What the editor shows before the owner has spent anything. */
  quota: orgProcedure.query(async ({ ctx }) => {
    const c = ctx as unknown as OrgContext
    return checkQuota(c.membership.orgId, { skipRateLimit: true })
  }),

  /**
   * One conversational edit turn.
   *
   * The model never writes to the database. It returns a candidate specification, this
   * validates it, and only then is a version written — so a bad turn costs a chat
   * message and nothing else.
   */
  chat: orgProcedure
    .input(siteInput.extend({ message: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      const spec = await loadDraft(c, input.siteId)

      try {
        const outcome = await editSite({
          orgId: c.membership.orgId,
          siteId: input.siteId,
          userId: c.userId,
          spec,
          message: input.message,
        })

        if (outcome.kind === 'undo') {
          const version = await undoLastChange(c.db, input.siteId, c.userId)
          return version
            ? { kind: 'undone' as const, reply: 'Done — I put it back the way it was.', version }
            : { kind: 'no-change' as const, reply: "There's nothing to undo yet." }
        }

        if (outcome.kind === 'failed')
          return { kind: 'failed' as const, reply: outcome.reply, errors: outcome.errors.slice(0, 5) }

        if (outcome.kind === 'no-change')
          return { kind: 'no-change' as const, reply: outcome.reply }

        const version = await writeVersion(c.db, {
          siteId: input.siteId,
          spec: outcome.spec,
          summary: summariseChanges(outcome.result),
          createdBy: 'ai',
          createdByUser: c.userId,
          patch: outcome.result.applied.map((a) => a.call),
        })

        return {
          kind: 'changed' as const,
          reply: outcome.reply,
          version,
          spec: outcome.spec,
          skipped: outcome.result.rejected.map((r) => r.reason),
        }
      } catch (e) {
        // Quota and circuit-breaker denials carry a message written for the owner; the
        // generic tRPC error page would replace it with something useless.
        if (e instanceof AiDenied)
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: e.message })
        throw e
      }
    }),

  undo: orgProcedure.input(siteInput).mutation(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    const version = await undoLastChange(c.db, input.siteId, c.userId)
    if (!version) throw new TRPCError({ code: 'BAD_REQUEST', message: "There's nothing to undo." })
    return version
  }),

  restore: orgProcedure
    .input(siteInput.extend({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      return restoreVersion(c.db, input.siteId, input.versionId, c.userId)
    }),

  ...fastPath,
})
