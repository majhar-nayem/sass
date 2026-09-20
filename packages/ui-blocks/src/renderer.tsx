import type { BusinessFacts, PageSpec, WebsiteSpec } from '@awning/spec'
import { Section } from './primitives.js'
import { renderSection } from './sections.js'
import { SectionBoundary } from './section-boundary.js'
import { AnnouncementBar, Footer, Navbar, StickyCallBar, WhatsAppBubble } from './globals.js'
import { themeToCss } from './theme.js'

export function SpecRenderer({
  spec,
  page,
  business,
}: {
  spec: WebsiteSpec
  page: PageSpec
  business: BusinessFacts
}) {
  const g = spec.globals
  const visible = page.sections.filter((s) => !s.hidden)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeToCss(spec.theme) }} />

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
                {renderSection(s, business, headingId)}
              </Section>
            </SectionBoundary>
          )
        })}
      </main>

      <Footer footer={spec.footer} site={spec.site} business={business} />

      {g?.whatsappBubble?.enabled && business.whatsapp && (
        <WhatsAppBubble number={business.whatsapp} prefill={g.whatsappBubble.prefillMessage} />
      )}
      {g?.stickyCallBar?.enabled && business.phone && (
        <StickyCallBar label={g.stickyCallBar.label} phone={business.phone} />
      )}
    </>
  )
}
