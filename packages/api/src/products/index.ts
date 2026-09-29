import { TRPCError } from '@trpc/server'
import type { PrismaTx } from '@awning/db'
import { logger } from '@awning/integrations/observability'
import { parseProductCsv, type ParsedProduct, type RowProblem } from './csv.js'

export * from './csv.js'

/**
 * M-04 -- products, and getting forty of them out of a spreadsheet.
 */

/** Australian Consumer Law: a "was" price must have been the actual selling price. */
export interface CompareAtAttestation {
  /**
   * The owner confirming, in the moment, that every was-price in this file was the
   * price the item actually sold at for a meaningful period.
   *
   * A CSV cannot attest to this. The file is a list of numbers; whether those numbers
   * were ever charged is a fact only the business knows, and displaying a struck-out
   * price that was never real is misleading conduct — the exact thing the spec
   * validator refuses to let the AI generate, and the exact thing our own acceptable
   * use policy tells customers not to do.
   *
   * So the database will not store one without a timestamp (the
   * `compare_at_needs_attestation` check), and this is where that timestamp comes from.
   */
  confirmed: boolean
}

export interface ImportSummary {
  created: number
  updated: number
  skipped: number
  categoriesCreated: string[]
  problems: RowProblem[]
  /** Set when the file had was-prices and the owner did not attest to them. */
  compareAtDropped: number
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'product'

/** Slugs are unique per site, and two different hams are both "ham". */
async function uniqueSlug(db: PrismaTx, siteId: string, title: string, selfId?: string): Promise<string> {
  const base = slugify(title)
  for (let n = 0; n < 200; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`
    const clash = await db.products.findFirst({
      where: { site_id: siteId, slug: candidate, ...(selfId ? { NOT: { id: selfId } } : {}) },
      select: { id: true },
    })
    if (!clash) return candidate
  }
  return `${base}-${Date.now()}`
}

/** Categories arrive as free text in a column; the same name is the same category. */
async function categoryIdFor(
  db: PrismaTx,
  siteId: string,
  name: string,
  created: string[],
): Promise<string> {
  const slug = slugify(name)
  const existing = await db.product_categories.findFirst({
    where: { site_id: siteId, slug },
    select: { id: true },
  })
  if (existing) return existing.id

  const row = await db.product_categories.create({
    data: { site_id: siteId, name: name.trim().slice(0, 80), slug },
    select: { id: true },
  })
  created.push(name.trim())
  return row.id
}

/**
 * Applies a parsed file.
 *
 * Matching is on SKU, because a second import is nearly always the same spreadsheet
 * with the prices changed — and an import that duplicates forty products instead of
 * updating them is worse than one that fails. Rows with no SKU cannot be matched, so
 * they are matched on slug instead: two imports of "Christmas Ham" are the same ham.
 */
export async function importProducts(
  db: PrismaTx,
  siteId: string,
  products: ParsedProduct[],
  attestation: CompareAtAttestation,
  problems: RowProblem[] = [],
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    categoriesCreated: [],
    problems: [...problems],
    compareAtDropped: 0,
  }

  const attestedAt = attestation.confirmed ? new Date() : null

  for (const p of products) {
    try {
      const categoryId = p.category
        ? await categoryIdFor(db, siteId, p.category, summary.categoriesCreated)
        : null

      let compareAt = p.compareAtCents
      if (compareAt !== null && !attestedAt) {
        // The constraint would reject it anyway; dropping it here means the rest of
        // the product still imports rather than the row failing.
        compareAt = null
        summary.compareAtDropped++
      }

      const existing = p.sku
        ? await db.products.findFirst({ where: { site_id: siteId, sku: p.sku }, select: { id: true } })
        : await db.products.findFirst({
            where: { site_id: siteId, slug: slugify(p.title) },
            select: { id: true },
          })

      const common = {
        title: p.title.slice(0, 200),
        description: p.description,
        price_cents: p.priceCents,
        compare_at_cents: compareAt,
        compare_at_attested_at: compareAt !== null ? attestedAt : null,
        gst_free: p.gstFree,
        track_inventory: p.trackInventory,
        inventory_qty: p.inventoryQty,
        category_id: categoryId,
        status: p.status,
      }

      if (existing) {
        await db.products.update({ where: { id: existing.id }, data: common })
        summary.updated++
      } else {
        await db.products.create({
          data: {
            site_id: siteId,
            slug: await uniqueSlug(db, siteId, p.title),
            sku: p.sku,
            ...common,
          },
        })
        summary.created++
      }
    } catch (e) {
      // One bad row must not abandon the other thirty-nine.
      summary.skipped++
      summary.problems.push({
        row: p.row,
        column: null,
        message: `Could not import: ${(e as Error).message.split('\n')[0]?.slice(0, 160)}`,
      })
    }
  }

  logger.info('products.imported', {
    site_id: siteId,
    created: summary.created,
    updated: summary.updated,
    skipped: summary.skipped,
  })
  return summary
}

/**
 * Reads the file without writing anything.
 *
 * Forty products is enough that "let me see what this will do first" is the difference
 * between an owner trying it and an owner not trying it.
 */
export function previewProductCsv(text: string) {
  const parsed = parseProductCsv(text)
  return {
    ...parsed,
    willCreate: parsed.products.length,
    categories: [...new Set(parsed.products.map((p) => p.category).filter((c): c is string => !!c))],
    needsCompareAtAttestation: parsed.products.some((p) => p.compareAtCents !== null),
  }
}

const MAX_CSV_BYTES = 2_000_000

export function assertImportable(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES)
    throw new TRPCError({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'That file is larger than we can read in one go. Split it in half and import twice.',
    })
}

export async function listProducts(db: PrismaTx, siteId: string, opts: { limit?: number } = {}) {
  return db.products.findMany({
    where: { site_id: siteId },
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { title: 'asc' }],
    take: opts.limit ?? 200,
    select: {
      id: true, title: true, slug: true, sku: true, price_cents: true,
      compare_at_cents: true, gst_free: true, status: true, inventory_qty: true,
      track_inventory: true,
      product_categories: { select: { id: true, name: true } },
      product_images: { select: { asset_id: true, position: true }, orderBy: { position: 'asc' }, take: 1 },
    },
  })
}

export async function listCategories(db: PrismaTx, siteId: string) {
  return db.product_categories.findMany({
    where: { site_id: siteId },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, is_seasonal: true, _count: { select: { products: true } } },
  })
}

/**
 * Attaches an already-uploaded image to a product.
 *
 * The asset must belong to the same site. RLS scopes both tables to the org, but a
 * site and an asset within one org can still be mismatched, and a product showing
 * another site's photograph is a bug the owner would notice before we did.
 */
export async function attachProductImage(
  db: PrismaTx,
  siteId: string,
  productId: string,
  assetId: string,
): Promise<void> {
  const [product, asset] = await Promise.all([
    db.products.findFirst({ where: { id: productId, site_id: siteId }, select: { id: true } }),
    db.site_assets.findFirst({ where: { id: assetId, site_id: siteId }, select: { id: true } }),
  ])
  if (!product || !asset) throw new TRPCError({ code: 'NOT_FOUND' })

  const count = await db.product_images.count({ where: { product_id: productId } })
  await db.product_images.create({
    data: { product_id: productId, asset_id: assetId, position: count },
  })
}
