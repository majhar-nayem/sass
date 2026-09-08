import type { ReactNode } from 'react'
import type { SectionSpec } from '@awning/spec'

/* ------------------------------------------------------------------ primitives */

const BG: Record<string, string> = {
  default: 'transparent',
  surface: 'var(--brand-surface)',
  primary: 'var(--brand-primary)',
  accent: 'var(--brand-accent)',
  dark: 'var(--brand-neutral)',
  image: 'transparent',
}
const FG: Record<string, string> = {
  primary: 'var(--brand-on-primary)',
  accent: 'var(--brand-on-accent)',
  dark: '#ffffff',
}
const SPACING: Record<string, string> = {
  none: '0',
  sm: 'calc(var(--section-y) * .4)',
  md: 'calc(var(--section-y) * .7)',
  lg: 'var(--section-y)',
  xl: 'calc(var(--section-y) * 1.5)',
}

export function Section({
  background = 'default',
  spacing = 'lg',
  anchor,
  children,
}: {
  background?: string
  spacing?: string
  anchor?: string
  children: ReactNode
}) {
  return (
    <section
      id={anchor}
      style={{
        background: BG[background] ?? 'transparent',
        color: FG[background],
        paddingTop: SPACING[spacing] ?? SPACING.lg,
        paddingBottom: SPACING[spacing] ?? SPACING.lg,
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px' }}>{children}</div>
    </section>
  )
}

function Button({ cta, tone = 'primary' }: { cta: { label: string; href: string }; tone?: string }) {
  const solid = tone === 'primary'
  return (
    <a
      href={cta.href}
      style={{
        display: 'inline-block',
        padding: '.85rem 1.5rem',
        borderRadius: 'var(--radius)',
        fontWeight: 600,
        textDecoration: 'none',
        background: solid ? 'var(--brand-accent)' : 'transparent',
        color: solid ? 'var(--brand-on-accent)' : 'inherit',
        border: solid ? 'none' : '1.5px solid currentColor',
      }}
    >
      {cta.label}
    </a>
  )
}

/* ----------------------------------------------------------------------- hero */

/**
 * Variants are a style table, not branching. One JSX tree, N looks — which is what
 * makes "eight hero variants" a morning's work instead of eight components to maintain.
 */
const HERO: Record<string, { titleSize: string; pad: string; weight: number; upper?: boolean }> = {
  minimal: { titleSize: 'clamp(2rem,5vw,3.2rem)', pad: '3rem', weight: 500 },
  modern: { titleSize: 'clamp(2.2rem,6vw,4rem)', pad: '4rem', weight: 700 },
  luxury: { titleSize: 'clamp(2.4rem,7vw,4.6rem)', pad: '6rem', weight: 400 },
  bold: { titleSize: 'clamp(2.4rem,7vw,4.4rem)', pad: '3.5rem', weight: 900, upper: true },
  editorial: { titleSize: 'clamp(2rem,5.5vw,3.6rem)', pad: '4.5rem', weight: 400 },
  split: { titleSize: 'clamp(2.1rem,5.5vw,3.6rem)', pad: '4rem', weight: 700 },
  video: { titleSize: 'clamp(2.2rem,6vw,4rem)', pad: '5rem', weight: 700 },
  festive: { titleSize: 'clamp(2.2rem,6vw,3.8rem)', pad: '4rem', weight: 700 },
}
const HEIGHT: Record<string, number> = { compact: 0.6, medium: 1, tall: 1.4, full: 1.8 }

function Hero({ variant, props }: Extract<SectionSpec, { type: 'hero' }>) {
  const v = HERO[variant] ?? HERO.modern!
  const scale = HEIGHT[props.height] ?? 1
  const split = variant === 'split' && props.image
  return (
    <div
      style={{
        display: split ? 'grid' : 'block',
        gridTemplateColumns: split ? '1.1fr .9fr' : undefined,
        gap: '2.5rem',
        alignItems: 'center',
        paddingTop: `calc(${v.pad} * ${scale})`,
        paddingBottom: `calc(${v.pad} * ${scale})`,
        textAlign: props.align === 'center' && !split ? 'center' : 'left',
      }}
    >
      <div>
        {props.eyebrow && (
          <p
            style={{
              textTransform: 'uppercase',
              letterSpacing: '.12em',
              fontSize: '.78rem',
              fontWeight: 700,
              color: 'var(--brand-accent)',
              margin: '0 0 .8rem',
            }}
          >
            {props.eyebrow}
          </p>
        )}
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: v.titleSize,
            fontWeight: v.weight,
            textTransform: v.upper ? 'uppercase' : 'none',
            lineHeight: 1.05,
            letterSpacing: '-.02em',
            margin: '0 0 1rem',
            textWrap: 'balance',
          }}
        >
          {props.heading}
        </h1>
        {props.subheading && (
          <p style={{ fontSize: '1.12rem', lineHeight: 1.55, maxWidth: '38em', margin: '0 0 1.6rem', opacity: 0.85 }}>
            {props.subheading}
          </p>
        )}
        <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap' }}>
          {props.primaryCta && <Button cta={props.primaryCta} />}
          {props.secondaryCta && <Button cta={props.secondaryCta} tone="ghost" />}
        </div>
        {props.trustPoints?.length ? (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '1.6rem 0 0',
              display: 'flex',
              gap: '1.4rem',
              flexWrap: 'wrap',
              fontSize: '.9rem',
              opacity: 0.8,
            }}
          >
            {props.trustPoints.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {split && props.image && (
        <img
          src={`/_asset/${props.image.assetId}`}
          alt={props.image.alt}
          style={{ width: '100%', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)' }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- services */

function Services({ variant, props }: Extract<SectionSpec, { type: 'services' }>) {
  const cards = variant === 'cards'
  return (
    <>
      {props.heading && (
        <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', margin: '0 0 .5rem' }}>
          {props.heading}
        </h2>
      )}
      {props.subheading && <p style={{ opacity: 0.8, margin: '0 0 2rem' }}>{props.subheading}</p>}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit,minmax(${props.columns >= 4 ? 200 : 250}px,1fr))`,
          gap: '1.2rem',
          marginTop: '1.5rem',
        }}
      >
        {props.items.map((item) => (
          <div
            key={item.title}
            style={{
              padding: cards ? '1.4rem' : '0',
              borderRadius: 'var(--radius)',
              background: cards ? 'var(--brand-surface)' : 'transparent',
              boxShadow: cards ? 'var(--shadow)' : 'none',
            }}
          >
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 .4rem' }}>
              {item.title}
            </h3>
            {item.description && (
              <p style={{ margin: 0, fontSize: '.95rem', lineHeight: 1.5, opacity: 0.82 }}>
                {item.description}
              </p>
            )}
            {item.priceFrom && (
              <p style={{ margin: '.6rem 0 0', fontWeight: 600, color: 'var(--brand-accent)' }}>
                {item.priceFrom}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------ cta */

function Cta({ props }: Extract<SectionSpec, { type: 'cta' }>) {
  return (
    <div style={{ textAlign: 'center' }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', margin: '0 0 .6rem' }}>
        {props.heading}
      </h2>
      {props.subheading && <p style={{ opacity: 0.85, margin: '0 0 1.4rem' }}>{props.subheading}</p>}
      <div style={{ display: 'flex', gap: '.8rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button cta={props.primaryCta} />
        {props.secondaryCta && <Button cta={props.secondaryCta} tone="ghost" />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- registry */

/**
 * An unknown type renders nothing rather than throwing. During a rolling deploy an old
 * renderer will meet a spec containing a component it does not know; omitting the
 * section is survivable, 500-ing every request for that tenant is not.
 */
export function renderSection(section: SectionSpec) {
  switch (section.type) {
    case 'hero':
      return <Hero {...section} />
    case 'services':
      return <Services {...section} />
    case 'cta':
      return <Cta {...section} />
    default:
      return null
  }
}

export const IMPLEMENTED_TYPES = ['hero', 'services', 'cta'] as const
