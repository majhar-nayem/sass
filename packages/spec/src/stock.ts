import { z } from 'zod'

/**
 * C-06 -- the curated stock pool.
 *
 * Deliberately NOT AI image generation. At roughly A$0.04-0.08 an image and six to ten
 * images a site, generation is the single largest variable cost in the product for a
 * result that is worse than a hand-picked photograph — and a generated "photo of your
 * shopfront" that is not their shopfront is an Australian Consumer Law problem, not
 * just a quality one (docs/04-AI-LAYER.md §2).
 *
 * The model picks from this pool by `stock:` id. It cannot reference an image that does
 * not exist, because validation rejects an unknown id.
 */
export const StockLicence = z.enum([
  'unsplash', // Unsplash Licence: free to use, attribution appreciated not required
  'pexels', // Pexels Licence: free to use, attribution appreciated not required
  'cc0', // public domain
  'owned', // shot or commissioned by us; we hold the rights
  'generated', // produced by us procedurally; abstract textures, never a fake photo
])
export type StockLicence = z.infer<typeof StockLicence>

export const StockEntry = z.object({
  /** The id a spec references, without the `stock:` prefix. */
  id: z.string().regex(/^[a-z0-9-]{3,60}$/),
  /** Industries this suits. Empty means it suits any. */
  industries: z.array(z.string()).default([]),
  /** Used as alt text when the model does not write its own, so it must be real. */
  description: z.string().min(8).max(140),
  tags: z.array(z.string()).default([]),
  kind: z.enum(['photo', 'texture']).default('photo'),
  licence: StockLicence,
  /**
   * Attribution. Required for anything we did not make: getting this wrong is the same
   * class of mistake as inventing a testimonial, and the licences we accept all ask for
   * it even where they do not strictly require it.
   */
  credit: z.string().max(120).nullable(),
  sourceUrl: z.string().url().nullable(),
  /** Where the bytes come from at ingest time. Null for procedurally generated ones. */
  fetchUrl: z.string().url().nullable(),
})
export type StockEntry = z.infer<typeof StockEntry>

export const StockManifest = z.object({
  version: z.literal(1),
  entries: z.array(StockEntry),
})
export type StockManifest = z.infer<typeof StockManifest>

/**
 * A credited entry must actually carry its credit.
 *
 * The same rule the model is held to: do not assert provenance you do not have. An
 * Unsplash photo with a null credit is a curation mistake, and it fails here rather
 * than appearing uncredited on a customer's site.
 */
export function validateManifest(input: unknown): { ok: true; manifest: StockManifest } | { ok: false; errors: string[] } {
  const parsed = StockManifest.safeParse(input)
  if (!parsed.success)
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }

  const errors: string[] = []
  const seen = new Set<string>()
  for (const e of parsed.data.entries) {
    if (seen.has(e.id)) errors.push(`duplicate id "${e.id}"`)
    seen.add(e.id)

    const needsCredit = e.licence === 'unsplash' || e.licence === 'pexels'
    if (needsCredit && !e.credit) errors.push(`"${e.id}" is ${e.licence} but has no credit`)
    if (needsCredit && !e.sourceUrl) errors.push(`"${e.id}" is ${e.licence} but has no source URL`)
    if (e.licence === 'generated' && e.kind !== 'texture')
      errors.push(`"${e.id}" is generated, so it must be a texture — we do not pass generated images off as photographs`)
    if (e.licence !== 'generated' && !e.fetchUrl)
      errors.push(`"${e.id}" has no fetchUrl, so ingest cannot retrieve it`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: parsed.data }
}

export interface StockPoolOptions {
  industry?: string
  limit?: number
  kind?: 'photo' | 'texture'
}

/**
 * The slice of the pool put in front of the model for one generation.
 *
 * Industry matches first, then anything general. Capped because every entry costs
 * tokens in the cached prefix, and a model offered two hundred options does not choose
 * better than one offered thirty.
 */
export function selectPool(manifest: StockManifest, opts: StockPoolOptions = {}): StockEntry[] {
  const { industry, limit = 30, kind } = opts
  const matching = manifest.entries.filter((e) => !kind || e.kind === kind)

  if (!industry) return matching.slice(0, limit)

  const forIndustry = matching.filter((e) => e.industries.includes(industry))
  const general = matching.filter((e) => e.industries.length === 0)
  return [...forIndustry, ...general].slice(0, limit)
}

/** What the model sees: an id and a description, nothing else. */
export function poolForPrompt(entries: StockEntry[]): Array<{ assetId: string; description: string }> {
  return entries.map((e) => ({ assetId: `stock:${e.id}`, description: e.description }))
}

export function isStockId(assetId: string): boolean {
  return assetId.startsWith('stock:')
}

export function stockIdOf(assetId: string): string | null {
  return isStockId(assetId) ? assetId.slice(6) : null
}

/**
 * Every `stock:` reference in a spec must exist in the manifest.
 *
 * Without this the model can invent a plausible id and the renderer silently drops the
 * image, which reads as a broken layout rather than as an error anyone can find.
 */
export function unknownStockIds(spec: unknown, manifest: StockManifest): string[] {
  const known = new Set(manifest.entries.map((e) => e.id))
  const missing = new Set<string>()

  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      const id = stockIdOf(v)
      if (id && !known.has(id)) missing.add(v)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(spec)
  return [...missing]
}
