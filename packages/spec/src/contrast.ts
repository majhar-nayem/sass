/**
 * WCAG contrast maths.
 *
 * Lives in the spec package, not in ui-blocks, because contrast is a validation concern
 * before it is a rendering one: a palette that cannot carry legible text must be
 * rejected at generation time, not discovered when someone looks at the site.
 */
const HEX = /^#[0-9a-fA-F]{6}$/

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** 1:1 to 21:1. */
export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 1
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

export const ON_LIGHT = '#000000'
export const ON_DARK = '#ffffff'

/**
 * The legible foreground for a background, chosen by comparing both candidates rather
 * than by a luminance threshold. A threshold gets mid-tone colours wrong — see
 * docs/05-COMPONENTS.md §7 for the bug this replaced.
 */
export function autoContrast(background: string): string {
  if (!HEX.test(background)) return ON_LIGHT
  return contrastRatio(background, ON_DARK) > contrastRatio(background, ON_LIGHT) ? ON_DARK : ON_LIGHT
}

export const AA_BODY = 4.5
export const AA_LARGE = 3.0

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}
function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/**
 * Darkens (or lightens) a colour until it reads at `target` against `background`.
 *
 * A brand accent is chosen to look good as a FILL — an orange button, a green header.
 * The same colour as small text on a pale background is usually around 3:1, which fails
 * WCAG AA. Rejecting those palettes would rule out most colours a small business
 * actually picks, so instead we keep the accent for fills and derive a text-safe
 * variant from it: same hue, enough contrast to read.
 */
export function readableOn(colour: string, background: string, target = AA_BODY): string {
  if (!HEX.test(colour) || !HEX.test(background)) return colour
  if (contrastRatio(colour, background) >= target) return colour

  // Move away from the background's luminance, not blindly darker: an accent on a dark
  // section has to get lighter.
  const towardsBlack = luminance(background) > 0.35
  let [r, g, b] = toRgb(colour)

  for (let step = 0; step < 40; step++) {
    const factor = towardsBlack ? 0.94 : 1.07
    ;[r, g, b] = towardsBlack ? [r * factor, g * factor, b * factor] : [
      r + (255 - r) * (factor - 1),
      g + (255 - g) * (factor - 1),
      b + (255 - b) * (factor - 1),
    ]
    const candidate = toHex([r, g, b])
    if (contrastRatio(candidate, background) >= target) return candidate
  }
  // Nothing in this hue reaches the target; fall back to something that certainly does.
  return autoContrast(background)
}
