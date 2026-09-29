import { cache } from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { storefront, storefrontProduct } from '@awning/commerce'
import { loadSiteByHost } from '@/lib/load-site'
import { shopForHost } from '@/lib/shop'
import { money, ShopFrame } from '@/components/shop-frame'
import { AddToCart } from '@/components/add-to-cart'

export const dynamic = 'force-dynamic'

// Memoised per request: generateMetadata and the page both call this.
const load = cache(async function load(slug: string) {
  const host = (await headers()).get('host') ?? ''
  const [site, shop] = await Promise.all([loadSiteByHost(host), shopForHost(host)])
  if (site.kind !== 'ok' || !shop?.status.enabled) return null
  const product = await storefront((db) => storefrontProduct(db, shop.siteId, slug))
  return product ? { site: site.site, shop, product } : null
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await load((await params).slug)
  if (!r) return { title: 'Not found', robots: { index: false } }
  return {
    title: `${r.product.title} | ${r.site.spec.site.businessName}`,
    description: r.product.description?.slice(0, 155) ?? undefined,
  }
}

/** Visitor-independent, like the listing. The only live part is <AddToCart>. */
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const r = await load((await params).slug)
  if (!r) notFound()
  const { product: p } = r

  return (
    <ShopFrame site={r.site}>
      <a href="/shop" className="text-sm underline">
        ← All products
      </a>
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        {p.imageUrl ? (
          // A plain <img>: tenant assets were already re-encoded and resized at upload (P-07).
          <img src={p.imageUrl} alt={p.title} className="aspect-square w-full rounded-[var(--radius)] object-cover" />
        ) : (
          <div aria-hidden="true" className="aspect-square w-full rounded-[var(--radius)] bg-[var(--brand-surface)]" />
        )}
        <div>
          {p.category && <p className="text-sm tracking-wide uppercase opacity-70">{p.category}</p>}
          <h1 className="font-heading mt-1 text-3xl font-semibold">{p.title}</h1>
          <p className="mt-4 text-2xl">
            {money(p.priceCents)}
            {p.compareAtCents && (
              <span className="ml-3 text-lg line-through opacity-60">
                <span className="sr-only">was </span>
                {money(p.compareAtCents)}
              </span>
            )}
          </p>
          {/* GST-inclusive is the only price an Australian consumer should see. */}
          <p className="mt-1 text-sm opacity-70">{p.gstFree ? 'GST free' : 'Includes GST'}</p>
          {p.lowStock !== null && <p className="mt-3 text-sm font-semibold">Only {p.lowStock} left</p>}
          {p.description && <p className="mt-6 leading-relaxed whitespace-pre-line">{p.description}</p>}
          {r.shop.status.acceptsOrders ? (
            <AddToCart productId={p.id} available={p.available} />
          ) : (
            <p className="mt-6 text-sm opacity-80">Online ordering is not open yet — ring us to order.</p>
          )}
        </div>
      </div>
    </ShopFrame>
  )
}
