import type { ReactNode } from 'react'
import { AssetProvider, Footer, Navbar, themeToCss } from '@awning/ui-blocks'
import type { LoadedSite } from '@/lib/load-site'

/**
 * The business's own header, footer and colours around a shop page, so the shop reads
 * as part of their website rather than a checkout bolted onto it.
 *
 * Takes only the published site — nothing about the visitor. That is what lets
 * Cloudflare cache every page that uses it.
 */
export function ShopFrame({ site, children }: { site: LoadedSite; children: ReactNode }) {
  const { spec, business } = site
  return (
    <AssetProvider value={site.assets}>
      <style dangerouslySetInnerHTML={{ __html: themeToCss(spec.theme) }} />
      <Navbar nav={spec.nav} site={spec.site} business={business} />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-10 md:py-14">
        {children}
      </main>
      <Footer footer={spec.footer} site={spec.site} business={business} />
    </AssetProvider>
  )
}

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
