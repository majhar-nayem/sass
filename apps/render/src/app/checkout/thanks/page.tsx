import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { loadSiteByHost } from '@/lib/load-site'
import { ShopFrame } from '@/components/shop-frame'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Thank you', robots: { index: false, follow: false } }

/**
 * Identical for every shopper — no order number, no name, no total — so it is safe to
 * cache, and it cannot be used to read anyone's order by guessing a URL. The receipt
 * with the details comes from Stripe, by email, from the business's own account.
 */
export default async function Thanks({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const site = await loadSiteByHost((await headers()).get('host') ?? '')
  if (site.kind !== 'ok') notFound()
  const pending = (await searchParams).pending === '1'

  return (
    <ShopFrame site={site.site}>
      <div className="mx-auto max-w-[52ch] py-10 text-center">
        <h1 className="font-heading text-3xl font-semibold">{pending ? 'Almost there' : 'Thank you'}</h1>
        <p className="mt-4 leading-relaxed">
          {pending
            ? 'Your payment is still being confirmed. You will get an email as soon as it goes through — there is no need to order again.'
            : 'Your order is in. A receipt is on its way to your email.'}
        </p>
        <a href="/shop" className="mt-8 inline-block underline">
          Back to the shop
        </a>
      </div>
    </ShopFrame>
  )
}
