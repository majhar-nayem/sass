import { TRPCError } from '@trpc/server'
import type { WebsiteSpec } from '@awning/spec'
import type { PrismaTx } from '@awning/db'

/**
 * A-10 -- version history.
 *
 * `site_versions` is append-only. A row is never updated and never deleted by an edit,
 * which is what makes undo a pointer move rather than a diff, and what means a bad AI
 * turn can always be walked back to something a human approved.
 *
 * The draft pointer moves; the published pointer does not. Editing a live site changes
 * nothing the public can see until the owner publishes — so an owner can experiment at
 * 9pm without their customers watching it happen.
 */

export interface WriteVersionInput {
  siteId: string
  spec: WebsiteSpec
  summary: string
  createdBy: 'user' | 'ai' | 'system' | 'template'
  createdByUser?: string | undefined
  patch?: unknown
  conversationId?: string | undefined
}

export async function writeVersion(db: PrismaTx, input: WriteVersionInput) {
  const site = await db.sites.findUnique({
    where: { id: input.siteId },
    select: { id: true, draft_version_id: true },
  })
  if (!site) throw new TRPCError({ code: 'NOT_FOUND' })

  const last = await db.site_versions.findFirst({
    where: { site_id: input.siteId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })

  const serialised = JSON.stringify(input.spec)
  const version = await db.site_versions.create({
    data: {
      site_id: input.siteId,
      version: (last?.version ?? 0) + 1,
      parent_version_id: site.draft_version_id,
      spec_json: input.spec as never,
      spec_version: input.spec.specVersion,
      summary: input.summary,
      created_by: input.createdBy,
      created_by_user: input.createdByUser ?? null,
      ai_conversation_id: input.conversationId ?? null,
      patch_json: (input.patch ?? null) as never,
      byte_size: serialised.length,
    },
    select: { id: true, version: true, summary: true, created_at: true },
  })

  // The draft pointer moves. published_version_id deliberately does not: editing is
  // not publishing.
  await db.sites.update({
    where: { id: input.siteId },
    data: { draft_version_id: version.id },
  })

  return version
}

export async function currentDraftSpec(db: PrismaTx, siteId: string): Promise<WebsiteSpec | null> {
  const site = await db.sites.findUnique({
    where: { id: siteId },
    select: { site_versions_sites_draft_version_idTosite_versions: { select: { spec_json: true } } },
  })
  const raw = site?.site_versions_sites_draft_version_idTosite_versions?.spec_json
  return (raw as WebsiteSpec) ?? null
}

/**
 * Steps the draft back to its parent.
 *
 * Restoring writes a NEW version rather than moving the pointer backwards. That costs a
 * row and buys two things: undo is itself undoable, and the history stays a truthful
 * record of what happened rather than quietly losing the step that was reverted.
 */
export async function undoLastChange(
  db: PrismaTx,
  siteId: string,
  userId: string,
): Promise<{ id: string; version: number; summary: string | null } | null> {
  const site = await db.sites.findUnique({
    where: { id: siteId },
    select: { draft_version_id: true },
  })
  if (!site?.draft_version_id) return null

  const currentVersion = await db.site_versions.findUnique({
    where: { id: site.draft_version_id },
    select: { id: true, parent_version_id: true, summary: true },
  })
  if (!currentVersion?.parent_version_id) return null

  const parent = await db.site_versions.findUnique({
    where: { id: currentVersion.parent_version_id },
    select: { spec_json: true, version: true },
  })
  if (!parent) return null

  return writeVersion(db, {
    siteId,
    spec: parent.spec_json as WebsiteSpec,
    summary: `Undid: ${currentVersion.summary ?? 'the last change'}`,
    createdBy: 'user',
    createdByUser: userId,
  })
}

export async function restoreVersion(
  db: PrismaTx,
  siteId: string,
  versionId: string,
  userId: string,
) {
  // Scoped by site_id as well as id: without it, a version id from another tenant would
  // be restorable. RLS already blocks that, which is exactly why this belt-and-braces
  // check is cheap.
  const target = await db.site_versions.findFirst({
    where: { id: versionId, site_id: siteId },
    select: { spec_json: true, version: true, summary: true },
  })
  if (!target) throw new TRPCError({ code: 'NOT_FOUND' })

  return writeVersion(db, {
    siteId,
    spec: target.spec_json as WebsiteSpec,
    summary: `Restored version ${target.version}`,
    createdBy: 'user',
    createdByUser: userId,
  })
}

/**
 * Prunes history: keep everything from the last 90 days, and at least the last 50
 * versions whatever their age. Never prunes the published version or anything reachable
 * as a parent of a version being kept, or undo would break for a site nobody has touched
 * in a while.
 */
export async function pruneVersions(db: PrismaTx, siteId: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 864e5)

  const keep = await db.site_versions.findMany({
    where: { site_id: siteId },
    orderBy: { version: 'desc' },
    take: 50,
    select: { id: true, parent_version_id: true },
  })
  const site = await db.sites.findUnique({
    where: { id: siteId },
    select: { published_version_id: true, draft_version_id: true },
  })

  const protectedIds = new Set<string>(
    [
      ...keep.map((k) => k.id),
      ...keep.map((k) => k.parent_version_id).filter((x): x is string => !!x),
      site?.published_version_id,
      site?.draft_version_id,
    ].filter((x): x is string => !!x),
  )

  const { count } = await db.site_versions.deleteMany({
    where: { site_id: siteId, created_at: { lt: cutoff }, id: { notIn: [...protectedIds] } },
  })
  return count
}
