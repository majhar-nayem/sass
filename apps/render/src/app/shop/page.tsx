import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { listStorefrontProducts, storefront } from '@awning/commerce'
import { loadSiteByHost } from '@/lib/load-site'
import { shopForHost } from '@/lib/shop'
import { money, ShopFrame } from '@/components/shop-frame'

export const dynamic = 'force-dynamic'

/**
 * M-05 -- the product listing.
 *
 * Reads nothing about the visitor. No cookie, no session, no cart count in the header —
 * which is what makes it safe for a CDN to serve one copy to everybody. The cart lives
 * behind /api/cart and is fetched by the browser.
 */
export async function generateMetadata(): Promise<Metadata> {
  const r = await loadSiteByHost((await headers()).get('host') ?? '')
  return r.kind === 'ok' ? { title: `Shop | ${r.site.spec.site.businessName}` } : { title: 'Not found' }
}

export default async function Shop() {
  const host = (await headers()).get('host') ?? ''
  const [site, shop] = await Promise.all([loadSiteByHost(host), shopForHost(host)])
  if (site.kind !== 'ok' || !shop?.status.enabled) notFound()

  const products = await storefront((db) => listStorefrontProducts(db, shop.siteId))

  return (
    <ShopFrame site={site.site}>
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-heading text-3xl font-semibold">Shop</h1>
        <a href="/cart" className="text-sm font-semibold underline">
          View cart
        </a>
      </div>

      {!shop.status.acceptsOrders && (
        // Honest about the state rather than letting someone fill a cart they cannot pay for.
        <p className="mb-8 rounded-[var(--radius)] bg-[var(--brand-surface)] px-4 py-3 text-sm">
          Online ordering is not open yet. You can browse, and ring us to order.
        </p>
      )}

      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <li key={p.id}>
            <a href={`/shop/${p.slug}`} className="group block">
              {p.imageUrl ? (
                // A plain <img>: tenant assets were already re-encoded and resized at upload (P-07).
                <img
                  src={p.imageUrl}
                  alt=""
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-[var(--radius)] object-cover"
                />
              ) : (
                <div aria-hidden="true" className="aspect-[4/3] w-full rounded-[var(--radius)] bg-[var(--brand-surface)]" />
              )}
              <p className="mt-3 font-semibold group-hover:underline">{p.title}</p>
              <p className="mt-1">
                {money(p.priceCents)}
                {p.compareAtCents && (
                  <span className="ml-2 text-sm line-through opacity-60">
                    <span className="sr-only">was </span>
                    {money(p.compareAtCents)}
                  </span>
                )}
                {!p.available && <span className="ml-2 text-sm opacity-70">Sold out</span>}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </ShopFrame>
  )
}
