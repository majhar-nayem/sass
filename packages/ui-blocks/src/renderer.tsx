import type { WebsiteSpec, PageSpec } from '@awning/spec'
import { Section, renderSection } from './sections.js'
import { SectionBoundary } from './section-boundary.js'
import { themeToCss } from './theme.js'

export function SpecRenderer({ spec, page }: { spec: WebsiteSpec; page: PageSpec }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeToCss(spec.theme) }} />
      <main>
        {page.sections
          .filter((s) => !s.hidden)
          .map((s) => (
            <SectionBoundary key={s.id} sectionId={s.id} type={s.type}>
              <Section background={s.background} spacing={s.spacing} anchor={s.anchor}>
                {renderSection(s)}
              </Section>
            </SectionBoundary>
          ))}
      </main>
    </>
  )
}
