import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rawPrisma } from '@awning/db'
import { importProducts, listCategories, listProducts, parseProductCsv, previewProductCsv } from '../products/index.js'

const orgId = randomUUID()
const siteId = randomUUID()

const run = async (csv: string, attested = false) => {
  const parsed = parseProductCsv(csv)
  return importProducts(rawPrisma, siteId, parsed.products, { confirmed: attested }, parsed.problems)
}

beforeAll(async () => {
  await rawPrisma.organizations.create({
    data: { id: orgId, name: 'Import Test', slug: `imp-${orgId.slice(0, 8)}`, state: 'SA' },
  })
  await rawPrisma.sites.create({
    data: { id: siteId, org_id: orgId, name: 'Butcher', slug: `imp-${siteId.slice(0, 8)}`, status: 'draft' },
  })
})

beforeEach(async () => {
  await rawPrisma.products.deleteMany({ where: { site_id: siteId } })
  await rawPrisma.product_categories.deleteMany({ where: { site_id: siteId } })
})

/** The acceptance criterion, literally. */
describe('forty products in one go', () => {
  const forty = [
    'Product,SKU,Price,Category,Stock',
    ...Array.from({ length: 40 }, (_, i) => `Item ${i + 1},SKU-${i + 1},${(i + 5).toFixed(2)},Butchery,${i}`),
  ].join('\n')

  it('imports all forty', async () => {
    const s = await run(forty)
    expect(s.created).toBe(40)
    expect(s.skipped).toBe(0)
    expect(await rawPrisma.products.count({ where: { site_id: siteId } })).toBe(40)
  })

  it('creates the category once, not forty times', async () => {
    await run(forty)
    const cats = await listCategories(rawPrisma, siteId)
    expect(cats).toHaveLength(1)
    expect(cats[0]!._count.products).toBe(40)
  })
})

describe('importing the same sheet twice', () => {
  const csv = 'Product,SKU,Price\nChristmas Ham,HAM-1,68.00'

  // The second import is nearly always the same spreadsheet with the prices changed.
  it('updates on SKU rather than duplicating', async () => {
    await run(csv)
    const second = await run('Product,SKU,Price\nChristmas Ham,HAM-1,72.00')
    expect(second.created).toBe(0)
    expect(second.updated).toBe(1)
    const rows = await rawPrisma.products.findMany({ where: { site_id: siteId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.price_cents).toBe(7200)
  })

  it('falls back to the name when there is no SKU', async () => {
    await run('Product,Price\nChristmas Ham,68.00')
    const second = await run('Product,Price\nChristmas Ham,70.00')
    expect(second.updated).toBe(1)
    expect(await rawPrisma.products.count({ where: { site_id: siteId } })).toBe(1)
  })

  it('gives two different products with the same name distinct slugs', async () => {
    await run('Product,SKU,Price\nHam,A,10\nHam,B,12')
    const slugs = (await rawPrisma.products.findMany({ where: { site_id: siteId }, select: { slug: true } })).map((p) => p.slug)
    expect(new Set(slugs).size).toBe(2)
  })
})

/**
 * The Australian Consumer Law point. A struck-out "was" price that was never the
 * actual selling price is misleading conduct, and a CSV cannot attest to whether a
 * number was ever charged — only the business knows that.
 */
describe('was-prices need the owner to say so', () => {
  const csv = 'Product,Price,Was Price\nChristmas Ham,68.00,85.00'

  it('drops the was-price when the owner has not attested', async () => {
    const s = await run(csv, false)
    expect(s.compareAtDropped).toBe(1)
    const p = await rawPrisma.products.findFirst({ where: { site_id: siteId } })
    expect(p!.compare_at_cents).toBeNull()
    expect(p!.compare_at_attested_at).toBeNull()
  })

  it('but still imports the product', async () => {
    const s = await run(csv, false)
    expect(s.created).toBe(1)
  })

  it('stores it with a timestamp when they have', async () => {
    await run(csv, true)
    const p = await rawPrisma.products.findFirst({ where: { site_id: siteId } })
    expect(p!.compare_at_cents).toBe(8500)
    expect(p!.compare_at_attested_at).toBeInstanceOf(Date)
  })

  // Belt and braces: the database refuses the combination regardless of our code.
  it('the database refuses a was-price with no attestation', async () => {
    await expect(
      rawPrisma.products.create({
        data: {
          site_id: siteId, title: 'Sneaky', slug: 'sneaky', price_cents: 100,
          compare_at_cents: 200, compare_at_attested_at: null,
        },
      }),
    ).rejects.toThrow()
  })
})

describe('one bad row', () => {
  it('does not cost the others', async () => {
    const s = await run('Product,Price\nHam,68.00\nMystery,POA\nTurkey,45.00')
    expect(s.created).toBe(2)
    expect(s.problems).toHaveLength(1)
    expect(s.problems[0]!.row).toBe(3)
  })

  it('reports the row number so it can be found in Excel', async () => {
    const s = await run('Product,Price\nHam,68\n,20\nTurkey,45')
    expect(s.problems[0]!.row).toBe(3)
  })
})

describe('preview', () => {
  it('writes nothing', async () => {
    previewProductCsv('Product,Price\nHam,68.00')
    expect(await rawPrisma.products.count({ where: { site_id: siteId } })).toBe(0)
  })

  it('says what will happen, including whether an attestation is needed', () => {
    const p = previewProductCsv('Product,Price,RRP,Category\nHam,68,85,Christmas')
    expect(p.willCreate).toBe(1)
    expect(p.categories).toEqual(['Christmas'])
    expect(p.needsCompareAtAttestation).toBe(true)
  })

  it('does not ask for an attestation when there are no was-prices', () => {
    expect(previewProductCsv('Product,Price\nHam,68').needsCompareAtAttestation).toBe(false)
  })
})

describe('what the catalogue screen sees', () => {
  it('lists products with their category and GST treatment', async () => {
    await run('Product,SKU,Price,Category,GST Free\nDiced beef,B1,22.50,Butchery,yes\nSkewers,S1,14.00,Butchery,no')
    const list = await listProducts(rawPrisma, siteId)
    expect(list).toHaveLength(2)
    const beef = list.find((p) => p.sku === 'B1')!
    expect(beef.gst_free).toBe(true)
    expect(beef.product_categories?.name).toBe('Butchery')
  })

  it('imports as drafts, so nothing goes live by surprise', async () => {
    await run('Product,Price\nHam,68')
    const list = await listProducts(rawPrisma, siteId)
    expect(list[0]!.status).toBe('draft')
  })
})
