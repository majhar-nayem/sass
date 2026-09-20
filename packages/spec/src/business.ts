import { z } from 'zod'

/**
 * Facts about the business, as opposed to decisions about the website.
 *
 * These live on the `sites` row, not in the spec, because the spec is the design and
 * these are data: the contact form, the order emails and the JSON-LD all need the phone
 * number, and none of them render a spec. It also means changing a phone number is one
 * UPDATE rather than a new site version.
 */
export const BusinessFacts = z.object({
  businessName: z.string(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  abn: z.string().nullable().optional(),
  address: z
    .object({
      line1: z.string().optional(),
      suburb: z.string().optional(),
      state: z.string().optional(),
      postcode: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    })
    .nullable()
    .optional(),
  serviceAreas: z.array(z.string()).default([]),
  socials: z.record(z.string()).default({}),
  /** Keyed by lowercase weekday; null means closed that day. */
  openingHours: z
    .record(z.object({ open: z.string(), close: z.string() }).nullable())
    .nullable()
    .optional(),
})

export type BusinessFacts = z.infer<typeof BusinessFacts>

/** +61 8 8123 4567 -> tel:+61881234567 ; 08 8123 4567 -> tel:0881234567 */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/**
 * WhatsApp needs an international number with no punctuation. Australian owners enter
 * their mobile the way they say it (0412 345 678), which wa.me silently rejects.
 */
export function whatsappHref(number: string, prefill?: string): string {
  let n = number.replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  else if (n.startsWith('0')) n = '61' + n.slice(1)
  else if (!n.startsWith('61')) n = '61' + n
  return `https://wa.me/${n}${prefill ? `?text=${encodeURIComponent(prefill)}` : ''}`
}
