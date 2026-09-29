import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadSiteByHost } from '@/lib/load-site'
import { shopForHost } from '@/lib/shop'
import { ShopFrame } from '@/components/shop-frame'
import { CartView } from '@/components/cart-view'

export const dynamic = 'force-dynamic'
// A cart is never a search result.
export const metadata: Metadata = { title: 'Your cart', robots: { index: false, follow: false } }

/**
 * An empty shell, identical for everyone. The cart itself is fetched by <CartView> —
 * see there for why it must not be rendered on the server.
 */
export default async function Cart() {
  const host = (await headers()).get('host') ?? ''
  const [site, shop] = await Promise.all([loadSiteByHost(host), shopForHost(host)])
  if (site.kind !== 'ok' || !shop?.status.enabled) notFound()

  return (
    <ShopFrame site={site.site}>
      <h1 className="font-heading mb-8 text-3xl font-semibold">Your cart</h1>
      <CartView />
    </ShopFrame>
  )
}
