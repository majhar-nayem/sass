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

/** Pick black or white text for a background, by WCAG relative luminance. */
export function autoContrast(background: string): string {
  if (!HEX.test(background)) return '#111111'
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(background.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  return L > 0.45 ? '#111111' : '#ffffff'
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
