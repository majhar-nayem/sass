import { createHash } from 'node:crypto'
import type { PrismaTx } from '@awning/db'
import { LEGAL_DOCUMENTS, legalDocument, type LegalDocument } from './generated.js'

export { LEGAL_DOCUMENTS, legalDocument, type LegalDocument }

/**
 * O-05b -- accepting the terms, in a way that can be shown later.
 *
 * Recording "accepted: true" proves nothing a year from now, when the document has
 * been edited twice and the question is what was on screen at the time. So acceptance
 * is stored against the document's version AND the hash of its text.
 */

/** Documents a customer must accept before using the service. */
const REQUIRED = ['terms', 'acceptable-use']

export interface AcceptanceContext {
  ip?: string | undefined
  userAgent?: string | undefined
}

/**
 * Hashed with a per-deployment secret, so the stored value cannot be reversed by
 * running the 4 billion IPv4 addresses through SHA-256 — which is an afternoon's work
 * and would turn this column into a location history of our customers.
 */
function hashIp(ip: string | undefined): string | null {
  if (!ip) return null
  const salt = process.env.BETTER_AUTH_SECRET ?? ''
  return createHash('sha256').update(`${salt}:${ip.split(',')[0]!.trim()}`).digest('hex')
}

/**
 * Which required documents this person has not accepted at the current version.
 *
 * Empty means they are up to date. A non-empty result should stop them using the
 * service until they accept — that is the whole point of versioning.
 */
export async function outstandingDocuments(db: PrismaTx, userId: string): Promise<LegalDocument[]> {
  const required = requiredDocuments()
  const accepted = await db.legal_acceptances.findMany({
    where: { user_id: userId, document_id: { in: required.map((d) => d.id) } },
    select: { document_id: true, version: true },
  })
  return stillOutstanding(required, accepted)
}

export function requiredDocuments(): LegalDocument[] {
  return REQUIRED.map((id) => legalDocument(id)).filter((d): d is LegalDocument => !!d)
}

/**
 * Pure, so the version-bump path can be tested without manufacturing a database row
 * for a version that never existed.
 *
 * Highest accepted version wins, and only a version BELOW the current one is
 * outstanding — someone who accepted a newer version than we ship (a rollback) is not
 * asked to agree to older wording.
 */
export function stillOutstanding(
  required: LegalDocument[],
  accepted: Array<{ document_id: string; version: number }>,
): LegalDocument[] {
  const best = new Map<string, number>()
  for (const a of accepted) best.set(a.document_id, Math.max(best.get(a.document_id) ?? 0, a.version))
  return required.filter((d) => (best.get(d.id) ?? 0) < d.version)
}

/**
 * Records acceptance of every currently-required document.
 *
 * Idempotent: a duplicate click is a duplicate click, not a second agreement, and the
 * unique constraint says so. Accepting is one transaction — a half-accepted state
 * would be a person who agreed to the terms but not the acceptable use policy, which
 * is not a thing we want to have to reason about.
 */
export async function acceptCurrentDocuments(
  db: PrismaTx,
  userId: string,
  orgId: string | null,
  context: AcceptanceContext = {},
): Promise<{ recorded: string[] }> {
  const outstanding = await outstandingDocuments(db, userId)
  if (outstanding.length === 0) return { recorded: [] }

  await db.legal_acceptances.createMany({
    data: outstanding.map((d) => ({
      user_id: userId,
      org_id: orgId,
      document_id: d.id,
      version: d.version,
      sha256: d.sha256,
      ip_hash: hashIp(context.ip),
      user_agent: context.userAgent?.slice(0, 400) ?? null,
    })),
    skipDuplicates: true,
  })

  return { recorded: outstanding.map((d) => d.id) }
}

/** What this person agreed to, and when. For support, disputes, and their own request. */
export async function acceptanceHistory(db: PrismaTx, userId: string) {
  return db.legal_acceptances.findMany({
    where: { user_id: userId },
    orderBy: { accepted_at: 'desc' },
    select: { document_id: true, version: true, sha256: true, accepted_at: true },
  })
}

/**
 * Did this person accept exactly the text we still hold?
 *
 * A mismatch means a document was edited without bumping its version — the change
 * should have forced re-acceptance and did not. Worth surfacing rather than assuming.
 */
export function acceptanceMatchesCurrentText(row: { document_id: string; sha256: string }): boolean {
  const doc = legalDocument(row.document_id)
  return !!doc && doc.sha256 === row.sha256
}
