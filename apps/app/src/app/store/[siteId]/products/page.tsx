import { notFound, redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { currentUser } from '@/lib/session'
import { Products } from './products'

export const dynamic = 'force-dynamic'
const createCaller = createCallerFactory(appRouter)

export default async function ProductsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { siteId } = await params
  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  const site = await caller.site.get({ siteId }).catch(() => null)
  if (!site) notFound()

  const products = await caller.product.list({ siteId })
  return (
    <Products
      siteId={siteId}
      siteName={site.name}
      initial={products.map((p) => ({
        id: p.id,
        title: p.title,
        sku: p.sku,
        priceCents: p.price_cents,
        compareAtCents: p.compare_at_cents,
        gstFree: p.gst_free,
        status: p.status,
        category: p.product_categories?.name ?? null,
        inventoryQty: p.track_inventory ? p.inventory_qty : null,
      }))}
    />
  )
}
