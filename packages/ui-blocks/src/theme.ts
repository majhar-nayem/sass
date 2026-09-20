import type { ThemeSpec } from '@awning/spec'

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

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio between two hex colours, 1:1 to 21:1. */
export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 1
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Picks the legible foreground for a background by comparing both candidates, rather
 * than by a luminance threshold.
 *
 * The threshold version of this was wrong and shipped: it cut over at 0.45 when the
 * real crossover is 0.179, so every mid-tone colour — the oranges, golds and greens a
 * tradie or a butcher actually picks — got white text. #E4622B with white is 3.45:1 and
 * fails WCAG AA; with black it is 5.92:1 and passes. Comparing the two ratios has no
 * magic number to get wrong.
 *
 * The dark candidate is pure black, not #111111. That sounds like a detail and is not:
 * with #111111 the worst case across the colour space is 4.33:1, leaving a band of
 * mid-tone colours where NEITHER foreground reaches AA. Pure black lifts the worst case
 * to 4.58:1, so a legible foreground always exists.
 */
export const ON_LIGHT = '#000000'
export const ON_DARK = '#ffffff'

export function autoContrast(background: string): string {
  if (!HEX.test(background)) return ON_LIGHT
  return contrastRatio(background, ON_DARK) > contrastRatio(background, ON_LIGHT)
    ? ON_DARK
    : ON_LIGHT
}

export function themeToCss(theme: ThemeSpec): string {
  const primary = hex(theme.primary, '#1B2A33')
  const accent = hex(theme.accent, '#B8431F')
  const secondary = hex(theme.secondary, '#F2F2EF')
  const neutral = hex(theme.neutral, '#1A1A1A')
  const surface = hex(theme.surface, secondary)
  const onPrimary = hex(theme.onPrimary, autoContrast(primary))

  return `:root{
--brand-primary:${primary};
--brand-accent:${accent};
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
