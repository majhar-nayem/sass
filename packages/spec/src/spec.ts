import { z } from 'zod'
import {
  contactForm, countdown, cta, hero, imageText, services, testimonials,
} from './components/index.js'
import { sectionSchema } from './define.js'
import { AssetId, Cta, Font, Hex, Href, Id, Industry, IsoDateTime, Style } from './primitives.js'

export const SPEC_VERSION = 1 as const

/**
 * A discriminated union on `type`. This is what makes an invented component
 * ("parallaxHero") and a real component with an invented variant both impossible
 * rather than merely discouraged.
 */
export const Section = z.discriminatedUnion('type', [
  sectionSchema(hero),
  sectionSchema(services),
  sectionSchema(imageText),
  sectionSchema(testimonials),
  sectionSchema(countdown),
  sectionSchema(contactForm),
  sectionSchema(cta),
])

export const Theme = z.object({
  primary: Hex,
  secondary: Hex,
  accent: Hex,
  neutral: Hex,
  surface: Hex.optional(),
  onPrimary: Hex.optional(),
  headingFont: Font,
  bodyFont: Font,
  radius: z.enum(['none', 'sm', 'md', 'lg', 'full']).default('md'),
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  shadow: z.enum(['none', 'subtle', 'soft', 'dramatic']).default('soft'),
  buttonStyle: z.enum(['solid', 'outline', 'pill', 'sharp']).default('solid'),
  darkMode: z.boolean().default(false),
}).strict()

export const Page = z.object({
  id: Id,
  path: z.string().regex(/^\/[a-z0-9\-/]*$/).max(100),
  title: z.string().min(1).max(70),
  seo: z
    .object({
      title: z.string().max(60).optional(),
      description: z.string().max(160).optional(),
      noindex: z.boolean().default(false),
      ogImageAssetId: AssetId.optional(),
    })
    .optional(),
  sections: z.array(Section).min(1).max(20),
}).strict()

export const WebsiteSpecification = z
  .object({
    specVersion: z.literal(SPEC_VERSION),
    site: z.object({
      businessName: z.string().min(1).max(80),
      tagline: z.string().max(140).optional(),
      industry: Industry,
      style: Style,
      tone: z.enum(['friendly', 'professional', 'premium', 'warm', 'direct', 'playful']).default('friendly'),
      logoAssetId: AssetId.optional(),
      faviconAssetId: AssetId.optional(),
      locale: z.literal('en-AU').default('en-AU'),
      currency: z.literal('AUD').default('AUD'),
      showAbnInFooter: z.boolean().default(true),
    }),
    theme: Theme,
    nav: z
      .object({
        variant: z.enum(['simple', 'centered', 'split', 'minimal', 'sticky-cta']).default('simple'),
        items: z.array(z.object({ label: z.string().max(24), href: Href })).max(7).default([]),
        cta: Cta.optional(),
        showPhone: z.boolean().default(true),
      })
      .optional(),
    pages: z.array(Page).min(1).max(30),
    footer: z
      .object({
        variant: z.enum(['simple', 'columns', 'centered', 'rich']).default('simple'),
        showHours: z.boolean().default(false),
        showServiceAreas: z.boolean().default(false),
        legalLinks: z.boolean().default(true),
      })
      .optional(),
    globals: z
      .object({
        announcementBar: z
          .object({
            text: z.string().max(120),
            href: Href.optional(),
            variant: z.enum(['flat', 'gradient', 'festive', 'urgent']).default('flat'),
            dismissible: z.boolean().default(true),
            endsAt: IsoDateTime.optional(),
          })
          .optional(),
        whatsappBubble: z
          .object({ enabled: z.boolean(), prefillMessage: z.string().max(160).optional() })
          .optional(),
        stickyCallBar: z
          .object({ enabled: z.boolean(), label: z.string().max(30).optional() })
          .optional(),
      })
      .optional(),
  })
  .strict()

export type WebsiteSpec = z.infer<typeof WebsiteSpecification>
export type SectionSpec = z.infer<typeof Section>
export type ThemeSpec = z.infer<typeof Theme>
export type PageSpec = z.infer<typeof Page>
