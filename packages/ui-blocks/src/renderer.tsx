import type { BusinessFacts, PageSpec, WebsiteSpec } from '@awning/spec'
import { AssetContext, Section } from './primitives.js'
import { renderSection } from './sections.js'
import { SectionBoundary } from './section-boundary.js'
import { AnnouncementBar, Footer, Navbar, StickyCallBar, WhatsAppBubble } from './globals.js'
import { JsonLd } from './json-ld.js'
import { themeToCss } from './theme.js'

export function SpecRenderer({
  spec,
  page,
  business,
  host,
  siteId,
  assets,
}: {
  spec: WebsiteSpec
  page: PageSpec
  business: BusinessFacts
  /** Omitted in a preview: structured data for a draft would advertise an unpublished site. */
  host?: string
  /** Enables the contact form endpoint and the click beacons. */
  siteId?: string
  /** assetId -> public URL. Images with no entry are omitted. */
  assets?: Record<string, string>
}) {
  const g = spec.globals
  const visible = page.sections.filter((s) => !s.hidden)

  return (
    <AssetContext.Provider value={assets ?? {}}>
      <style dangerouslySetInnerHTML={{ __html: themeToCss(spec.theme) }} />
      {host && <JsonLd spec={spec} business={business} host={host} />}

      {g?.announcementBar && <AnnouncementBar bar={g.announcementBar} />}
      <Navbar nav={spec.nav} site={spec.site} business={business} />

      <main id="main">
        {visible.map((s) => {
          // Each section labels itself for screen readers via its own heading, so the
          // landmark list reads as the page's structure rather than "section, section".
          const headingId = `${s.id}-heading`
          return (
            <SectionBoundary key={s.id} sectionId={s.id} type={s.type}>
              <Section
                background={s.background}
                spacing={s.spacing}
                anchor={s.anchor}
                labelledBy={s.type === 'hero' ? undefined : headingId}
              >
                {renderSection(s, business, headingId, siteId)}
              </Section>
            </SectionBoundary>
          )
        })}
      </main>

      <Footer footer={spec.footer} site={spec.site} business={business} />

      {g?.whatsappBubble?.enabled && business.whatsapp && (
        <WhatsAppBubble
          number={business.whatsapp}
          prefill={g.whatsappBubble.prefillMessage}
          siteId={siteId}
        />
      )}
      {g?.stickyCallBar?.enabled && business.phone && (
        <StickyCallBar label={g.stickyCallBar.label} phone={business.phone} siteId={siteId} />
      )}
    </AssetContext.Provider>
  )
}
