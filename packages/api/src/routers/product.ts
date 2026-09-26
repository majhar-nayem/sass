import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { adminProcedure, orgProcedure, router, type OrgContext } from '../trpc.js'
import {
  assertImportable,
  attachProductImage,
  importProducts,
  listCategories,
  listProducts,
  parseProductCsv,
  previewProductCsv,
} from '../products/index.js'

const siteInput = z.object({ siteId: z.string().uuid() })

async function ownedSite(c: OrgContext, siteId: string) {
  const site = await c.db.sites.findUnique({ where: { id: siteId }, select: { id: true } })
  if (!site) throw new TRPCError({ code: 'NOT_FOUND' })
}

export const productRouter = router({
  list: orgProcedure.input(siteInput).query(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    await ownedSite(c, input.siteId)
    return listProducts(c.db, input.siteId)
  }),

  categories: orgProcedure.input(siteInput).query(async ({ ctx, input }) => {
    const c = ctx as unknown as OrgContext
    await ownedSite(c, input.siteId)
    return listCategories(c.db, input.siteId)
  }),

  /** Reads the file and reports what would happen. Writes nothing. */
  previewImport: orgProcedure
    .input(siteInput.extend({ csv: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      await ownedSite(c, input.siteId)
      assertImportable(input.csv)
      return previewProductCsv(input.csv)
    }),

  import: adminProcedure
    .input(
      siteInput.extend({
        csv: z.string().min(1),
        /**
         * The owner confirming every was-price in the file was the price the item
         * actually sold at. Not defaulted: an unticked box means the was-prices are
         * dropped, which is the safe direction. Claiming a saving that never existed
         * is misleading conduct, and it would be our code that published it.
         */
        compareAtAttested: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      await ownedSite(c, input.siteId)
      assertImportable(input.csv)
      const parsed = parseProductCsv(input.csv)
      return importProducts(
        c.db,
        input.siteId,
        parsed.products,
        { confirmed: input.compareAtAttested },
        parsed.problems,
      )
    }),

  attachImage: adminProcedure
    .input(siteInput.extend({ productId: z.string().uuid(), assetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = ctx as unknown as OrgContext
      await ownedSite(c, input.siteId)
      await attachProductImage(c.db, input.siteId, input.productId, input.assetId)
      return { ok: true }
    }),
})
