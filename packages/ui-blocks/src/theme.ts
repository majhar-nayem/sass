import { autoContrast, readableOn, type ThemeSpec } from '@awning/spec'

const RADIUS = { none: '0', sm: '4px', md: '10px', lg: '18px', full: '9999px' } as const
const DENSITY = { compact: '2.5rem', comfortable: '4.5rem', spacious: '7rem' } as const
const SHADOW = {
  none: 'none',
  subtle: '0 1px 2px rgba(0,0,0,.06)',
  soft: '0 4px 20px rgba(0,0,0,.08)',
  dramatic: '0 18px 50px rgba(0,0,0,.18)',
} as const

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * The theme reaches the page as CSS custom properties, so one stylesheet serves every
 * tenant and a colour change costs nothing at render time.
 *
 * This is a dangerouslySetInnerHTML boundary. The values are already schema-validated,
 * but they are re-checked here: a CSS injection at this point is a stored XSS on every
 * page of a customer's live site, and the check costs a regex.
 */
function hex(v: string | undefined, fallback: string): string {
  return v && HEX.test(v) ? v : fallback
}

export { autoContrast, contrastRatio, ON_LIGHT, ON_DARK } from '@awning/spec'

export function themeToCss(theme: ThemeSpec): string {
  const primary = hex(theme.primary, '#1B2A33')
  const accent = hex(theme.accent, '#B8431F')
  const secondary = hex(theme.secondary, '#F2F2EF')
  const neutral = hex(theme.neutral, '#1A1A1A')
  const surface = hex(theme.surface, secondary)
  const onPrimary = hex(theme.onPrimary, autoContrast(primary))
  // The accent as a FILL and the accent as TEXT are different colours. A brand orange
  // reads fine behind white button text and fails AA as small text on a pale section.
  const accentOnSurface = readableOn(accent, surface)
  const accentOnPage = readableOn(accent, '#ffffff')

  return `:root{
--brand-primary:${primary};
--brand-accent:${accent};
--brand-accent-text:${accentOnPage};
--brand-accent-text-surface:${accentOnSurface};
--brand-secondary:${secondary};
--brand-neutral:${neutral};
--brand-surface:${surface};
--brand-on-primary:${onPrimary};
--brand-on-accent:${autoContrast(accent)};
--font-heading:'${theme.headingFont.replace(/[^a-zA-Z0-9 ]/g, '')}',Georgia,serif;
--font-body:'${theme.bodyFont.replace(/[^a-zA-Z0-9 ]/g, '')}',system-ui,sans-serif;
--radius:${RADIUS[theme.radius] ?? RADIUS.md};
--section-y:${DENSITY[theme.density] ?? DENSITY.comfortable};
--shadow:${SHADOW[theme.shadow] ?? SHADOW.soft};
}`
}
