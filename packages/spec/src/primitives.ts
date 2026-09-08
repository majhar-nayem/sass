import { z } from 'zod'

/** Stable, human-readable section and page identifiers. */
export const Id = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'kebab-case, 1–40 chars, no trailing hyphen')

export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'six-digit hex colour')

/**
 * Closed set. Self-hosted, latin-subset, preloaded. Adding a font is a code change
 * and a licence check, not a decision the model gets to make at runtime.
 */
export const Font = z.enum([
  'Inter', 'Manrope', 'DM Sans', 'Plus Jakarta Sans', 'Work Sans', 'Source Sans 3',
  'Playfair Display', 'Fraunces', 'Lora', 'Libre Baskerville', 'Cormorant Garamond',
  'Space Grotesk', 'Archivo', 'Bebas Neue', 'Outfit', 'Poppins', 'Sora', 'Instrument Serif',
])

export const Industry = z.enum([
  'plumber','electrician','builder','carpenter','painter','roofer','cleaner','mechanic',
  'landscaper','pest-control','removalist','hvac','locksmith','barber','hair-salon','beauty',
  'nails','massage','tattoo','restaurant','cafe','bakery','butcher','grocer','caterer',
  'food-truck','gym','personal-trainer','yoga','physio','dentist','vet','accountant',
  'bookkeeper','lawyer','consultant','real-estate','photographer','retail','florist',
  'gift-shop','childcare','tutoring','other',
])

export const Style = z.enum([
  'clean-modern','premium-modern','bold-trade','warm-local','luxury','editorial',
  'rustic','minimal','vibrant','corporate','festive',
])

export const Icon = z.enum([
  'wrench','zap','hammer','droplet','home','truck','broom','car','leaf','scissors','sparkles',
  'heart','coffee','utensils','cake','beef','gift','shopping-bag','phone','mail','map-pin',
  'clock','calendar','shield','star','check','award','users','message-circle','dollar-sign',
  'thermometer','key','paint-roller','tree-pine',
])

export const AssetId = z
  .string()
  .regex(/^(asset_[a-zA-Z0-9]{8,}|stock:[a-z0-9-]{3,60})$/, 'an uploaded asset id or a stock: id')

/** Only schemes we are willing to render. Blocks javascript:, data:, vbscript:. */
export const Href = z
  .string()
  .regex(/^(\/|#|tel:|mailto:|https:\/\/|whatsapp:)/, 'must be a relative, anchor, tel, mailto, https or whatsapp link')

export const Cta = z.object({
  label: z.string().min(1).max(32),
  href: Href,
  style: z.enum(['primary', 'secondary', 'ghost', 'accent']).default('primary'),
  icon: z.enum(['none','phone','arrow','cart','calendar','whatsapp','email','quote']).default('none'),
})

/** alt is required: WCAG 2.1 AA, and it is cheap now and brutal to retrofit. */
export const ImageRef = z.object({
  assetId: AssetId,
  alt: z.string().min(1).max(140),
  focal: z.enum(['center', 'top', 'bottom', 'left', 'right']).default('center'),
})

export const IsoDateTime = z.string().datetime({ offset: true })
