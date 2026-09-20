'use client'
import { createContext, useContext, type ReactNode } from 'react'
import type { SectionSpec } from '@awning/spec'

/**
 * assetId -> public URL, resolved once when the spec is loaded.
 *
 * A context rather than prop-drilling through every section, and a map rather than a
 * lookup per image: one query at load beats one round trip per photo on a page.
 */
export const AssetContext = createContext<Record<string, string>>({})

/**
 * Shared building blocks. Every component is assembled from these, which is what keeps
 * spacing, contrast and tap targets consistent across the catalogue instead of being
 * re-decided per component.
 */

type Cta = NonNullable<Extract<SectionSpec, { type: 'cta' }>['props']['primaryCta']>
type Img = NonNullable<Extract<SectionSpec, { type: 'hero' }>['props']['image']>

const BG: Record<string, string> = {
  default: 'bg-transparent',
  surface: 'bg-brand-surface',
  primary: 'bg-brand text-brand-on-primary',
  accent: 'bg-brand-accent text-brand-on-accent',
  dark: 'bg-brand-neutral text-white',
  image: 'bg-transparent',
}

const SPACING: Record<string, string> = {
  none: 'py-0',
  sm: 'py-6 md:py-10',
  md: 'py-10 md:py-16',
  lg: 'py-14 md:py-[var(--section-y)]',
  xl: 'py-20 md:py-32',
}

export function Section({
  background = 'default',
  spacing = 'lg',
  anchor,
  labelledBy,
  children,
}: {
  background?: string
  spacing?: string
  anchor?: string
  labelledBy?: string
  children: ReactNode
}) {
  return (
    <section
      id={anchor}
      aria-labelledby={labelledBy}
      className={`${BG[background] ?? BG.default} ${SPACING[spacing] ?? SPACING.lg}`}
    >
      <div className="mx-auto w-full max-w-[1100px] px-5 md:px-8">{children}</div>
    </section>
  )
}

/** h2 for every section; the page's single h1 belongs to the hero. */
export function Heading({
  children,
  id,
  as: As = 'h2',
  className = '',
}: {
  children: ReactNode
  id?: string
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}) {
  const size =
    As === 'h1'
      ? 'text-[clamp(2rem,7vw,3.6rem)] leading-[1.05]'
      : As === 'h2'
        ? 'text-[clamp(1.5rem,4vw,2.2rem)] leading-tight'
        : 'text-lg leading-snug'
  return (
    <As
      id={id}
      className={`font-heading font-semibold tracking-tight text-balance ${size} ${className}`}
    >
      {children}
    </As>
  )
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-[46ch] text-base leading-relaxed opacity-80 md:text-lg">{children}</p>
}

/**
 * Minimum 44px tall on every button and link-button: this is a phone in a carpark,
 * often one-handed, and WCAG 2.5.5 is the floor rather than the goal.
 */
export function Button({
  cta,
  tone,
  className = '',
}: {
  cta: Cta
  tone?: 'primary' | 'ghost'
  className?: string
}) {
  const resolved = tone ?? (cta.style === 'ghost' || cta.style === 'secondary' ? 'ghost' : 'primary')
  const base =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] px-5 py-2.5 text-[0.97rem] font-semibold no-underline transition-colors'
  const look =
    resolved === 'primary'
      ? 'bg-brand-accent text-brand-on-accent hover:opacity-90'
      : 'border-[1.5px] border-current bg-transparent hover:bg-black/5'
  return (
    <a href={cta.href} className={`${base} ${look} ${className}`}>
      {cta.icon === 'phone' && <PhoneGlyph />}
      {cta.label}
      {cta.icon === 'arrow' && <span aria-hidden="true">&rarr;</span>}
    </a>
  )
}

function PhoneGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[1.05em] w-[1.05em] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  )
}

/**
 * Assets resolve through the image route, which serves a resized, re-encoded variant
 * from R2. alt is required by the schema, so there is no decorative-empty escape.
 */
export function Image({
  image,
  className = '',
  priority = false,
  sizes = '100vw',
}: {
  image: Img
  className?: string
  priority?: boolean
  sizes?: string
}) {
  const assets = useContext(AssetContext)
  const src = assets[image.assetId]
  // An asset that has been deleted, or a stock id with no pool entry, renders nothing
  // rather than a broken-image icon on a customer's live site.
  if (!src) return null
  const position =
    image.focal === 'top'
      ? 'object-top'
      : image.focal === 'bottom'
        ? 'object-bottom'
        : image.focal === 'left'
          ? 'object-left'
          : image.focal === 'right'
            ? 'object-right'
            : 'object-center'
  return (
    <img
      src={src}
      alt={image.alt}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding={priority ? 'sync' : 'async'}
      className={`object-cover ${position} ${className}`}
    />
  )
}

const COLUMNS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
}

export function Grid({ columns = 3, children }: { columns?: number; children: ReactNode }) {
  return <div className={`mt-8 grid grid-cols-1 gap-4 ${COLUMNS[columns] ?? COLUMNS[3]}`}>{children}</div>
}
