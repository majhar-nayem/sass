import { z } from 'zod'
import { defineComponent } from '../define.js'
import { Cta, ImageRef, Icon, IsoDateTime } from '../primitives.js'

export const hero = defineComponent({
  type: 'hero',
  variants: ['minimal', 'modern', 'luxury', 'bold', 'editorial', 'split', 'video', 'festive'],
  props: z.object({
    eyebrow: z.string().max(40).optional(),
    heading: z.string().min(3).max(70),
    subheading: z.string().max(200).optional(),
    image: ImageRef.optional(),
    primaryCta: Cta.optional(),
    secondaryCta: Cta.optional(),
    trustPoints: z.array(z.string().max(40)).max(4).optional(),
    height: z.enum(['compact', 'medium', 'tall', 'full']).default('medium'),
    align: z.enum(['left', 'center']).default('left'),
  }),
  aiGuidance: `The first thing a visitor sees. Put the single most valuable action in
primaryCta — for a trade that is almost always the phone number. Use 'split' when there
is a strong photo, 'minimal' when there is not. trustPoints are short factual points
only, never claims about licensing, insurance, awards or years in business unless the
owner supplied them.`,
  industryDefaults: {
    plumber: { variant: 'bold', props: { height: 'medium' } },
    electrician: { variant: 'bold' },
    beauty: { variant: 'minimal', props: { height: 'tall' } },
    butcher: { variant: 'split' },
  },
})

export const services = defineComponent({
  type: 'services',
  variants: ['cards', 'icons', 'list', 'alternating', 'numbered'],
  props: z.object({
    heading: z.string().max(70).optional(),
    subheading: z.string().max(200).optional(),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    items: z
      .array(
        z.object({
          title: z.string().max(50),
          description: z.string().max(220).optional(),
          icon: Icon.optional(),
          image: ImageRef.optional(),
          // ACL component pricing: a displayed price is the single total, GST included.
          priceFrom: z.string().max(24).optional(),
          href: z.string().optional(),
        }),
      )
      .min(2)
      .max(12),
  }),
  aiGuidance: `What the business actually does, in the owner's words. Two to six items.
Do not pad to fill a grid. priceFrom must be GST-inclusive and prefixed "From " when
indicative.`,
})

export const imageText = defineComponent({
  type: 'imageText',
  variants: ['left', 'right', 'stacked', 'overlap'],
  props: z.object({
    heading: z.string().max(70),
    body: z.string().max(1200),
    image: ImageRef.optional(),
    cta: Cta.optional(),
  }),
  aiGuidance: `The "about us" slot. Short. Who they are, where they are based, why
someone would choose a local independent business. No filler.`,
})

export const testimonials = defineComponent({
  type: 'testimonials',
  variants: ['cards', 'quote', 'carousel', 'compact'],
  props: z.object({
    heading: z.string().max(70).optional(),
    items: z
      .array(
        z.object({
          quote: z.string().min(10).max(400),
          author: z.string().max(60),
          location: z.string().max(60).optional(),
          rating: z.number().int().min(1).max(5).optional(),
          /**
           * The only permitted value. The model cannot author a testimonial, and the
           * renderer refuses any other source. Australian Consumer Law s29(1)(e) —
           * the ACCC actively pursues fabricated reviews.
           */
          source: z.literal('customer_supplied'),
        }),
      )
      .min(1)
      .max(12),
  }),
  aiGuidance: `ONLY testimonials the owner actually supplied. Never write one yourself,
not as a placeholder and not as an example. If the owner gave you none, omit this
section entirely — a site with no testimonials is fine, a site with invented ones is
illegal.`,
})

export const countdown = defineComponent({
  type: 'countdown',
  variants: ['bar', 'block', 'inline'],
  props: z.object({
    heading: z.string().max(70),
    /** A real deadline the business gave you. No evergreen or auto-resetting timers. */
    endsAt: IsoDateTime,
    expiredMessage: z.string().max(120).optional(),
    cta: Cta.optional(),
  }),
  aiGuidance: `Requires a real end date from the owner. If you do not have one, call
ask_user — do not invent a deadline. A fake countdown is misleading conduct under the
Australian Consumer Law.`,
})

export const contactForm = defineComponent({
  type: 'contactForm',
  variants: ['stacked', 'split', 'inline'],
  props: z.object({
    heading: z.string().max(70).optional(),
    subheading: z.string().max(200).optional(),
    submitLabel: z.string().max(30).default('Send enquiry'),
    successMessage: z.string().max(200).optional(),
    fields: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{1,24}$/),
          label: z.string().max(40),
          type: z.enum(['text', 'email', 'tel', 'textarea', 'select', 'date', 'checkbox']),
          required: z.boolean().default(false),
          options: z.array(z.string().max(40)).max(20).optional(),
          placeholder: z.string().max(60).optional(),
        }),
      )
      .min(2)
      .max(10),
  }),
  aiGuidance: `Ask for the least you can. Name, phone and a message converts far better
than eight fields. For trades, add a "job type" select when the services are distinct.`,
})

export const contact = defineComponent({
  type: 'contact',
  variants: ['details', 'split', 'map-split', 'compact'],
  props: z.object({
    heading: z.string().max(70).optional(),
    subheading: z.string().max(200).optional(),
    showPhone: z.boolean().default(true),
    showEmail: z.boolean().default(true),
    showAddress: z.boolean().default(true),
    showHours: z.boolean().default(false),
    showServiceAreas: z.boolean().default(false),
    showMap: z.boolean().default(false),
    note: z.string().max(220).optional(),
  }),
  aiGuidance: `Contact details, pulled from the business record rather than written by
you — never type a phone number or address into props. Turn on only what the business
actually has. For a trade, showServiceAreas is worth more than showAddress: people
search "plumber Salisbury", not the office address.`,
})

export const cta = defineComponent({
  type: 'cta',
  variants: ['banner', 'split', 'centered', 'strip'],
  props: z.object({
    heading: z.string().max(70),
    subheading: z.string().max(200).optional(),
    primaryCta: Cta,
    secondaryCta: Cta.optional(),
  }),
  aiGuidance: `One clear action. Verbs, specific: "Call for a free quote", not "Learn more".`,
})

export const COMPONENTS = [
  hero,
  services,
  imageText,
  testimonials,
  countdown,
  contact,
  contactForm,
  cta,
] as const
