import type { BusinessFacts, SectionSpec } from '@awning/spec'
import { telHref } from '@awning/spec'
import { Button, Grid, Heading, Image, Lede } from './primitives.js'
import { Countdown } from './countdown.js'
import { ContactForm } from './contact-form.js'

type Of<T extends SectionSpec['type']> = Extract<SectionSpec, { type: T }>

/* --------------------------------------------------------------------- hero */

/**
 * Variants are a style table, not branching. One JSX tree, eight looks — which is what
 * makes a variant a table row plus a story rather than a component to maintain.
 */
const HERO: Record<string, { title: string; pad: string; align?: string }> = {
  minimal: { title: 'font-medium', pad: 'py-12 md:py-20' },
  modern: { title: 'font-bold', pad: 'py-14 md:py-24' },
  luxury: { title: 'font-normal tracking-[-0.03em]', pad: 'py-20 md:py-36' },
  bold: { title: 'font-black uppercase tracking-[-0.02em]', pad: 'py-12 md:py-20' },
  editorial: { title: 'font-normal', pad: 'py-16 md:py-28' },
  split: { title: 'font-bold', pad: 'py-12 md:py-20' },
  video: { title: 'font-bold', pad: 'py-16 md:py-28' },
  festive: { title: 'font-bold', pad: 'py-14 md:py-24' },
}
const HERO_HEIGHT: Record<string, string> = {
  compact: 'md:py-12',
  medium: '',
  tall: 'md:py-32',
  full: 'md:py-44',
}

export function Hero({ variant, props }: Of<'hero'>) {
  const v = HERO[variant] ?? HERO.modern!
  const split = variant === 'split' && props.image
  const centred = props.align === 'center' && !split

  return (
    <div className={`${v.pad} ${HERO_HEIGHT[props.height] ?? ''}`}>
      <div
        className={
          split ? 'grid items-center gap-8 md:grid-cols-[1.05fr_0.95fr] md:gap-12' : 'block'
        }
      >
        <div className={centred ? 'mx-auto max-w-[44ch] text-center' : ''}>
          {props.eyebrow && (
            <p className="mb-3 text-[0.78rem] font-bold tracking-[0.12em] text-[var(--brand-accent-text)] uppercase">
              {props.eyebrow}
            </p>
          )}
          <Heading as="h1" className={v.title}>
            {props.heading}
          </Heading>
          {props.subheading && <Lede>{props.subheading}</Lede>}

          {(props.primaryCta || props.secondaryCta) && (
            <div className={`mt-7 flex flex-wrap gap-3 ${centred ? 'justify-center' : ''}`}>
              {props.primaryCta && <Button cta={props.primaryCta} />}
              {props.secondaryCta && <Button cta={props.secondaryCta} tone="ghost" />}
            </div>
          )}

          {props.trustPoints?.length ? (
            <ul
              className={`mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm opacity-75 ${centred ? 'justify-center' : ''}`}
            >
              {props.trustPoints.map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="text-[var(--brand-accent-text)]">
                    &#10003;
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {split && props.image && (
          <Image
            image={props.image}
            priority
            sizes="(max-width: 768px) 100vw, 45vw"
            className="aspect-[4/3] w-full rounded-[var(--radius)] shadow-[var(--shadow)] md:aspect-[5/4]"
          />
        )}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- services */

export function Services({ variant, props }: Of<'services'>, id?: string) {
  const cards = variant === 'cards'
  const numbered = variant === 'numbered'
  const list = variant === 'list'

  return (
    <>
      {props.heading && <Heading id={id}>{props.heading}</Heading>}
      {props.subheading && <Lede>{props.subheading}</Lede>}
      <Grid columns={list ? 2 : props.columns}>
        {props.items.map((item, i) => (
          <div
            key={item.title}
            className={
              cards
                ? 'rounded-[var(--radius)] bg-white/70 p-5 shadow-[var(--shadow)] ring-1 ring-black/5'
                : 'py-1'
            }
          >
            {numbered && (
              <span className="mb-2 block font-heading text-2xl font-bold text-[var(--brand-accent-text-surface)]">
                {String(i + 1).padStart(2, '0')}
              </span>
            )}
            <h3 className="font-heading text-lg leading-snug font-semibold">{item.title}</h3>
            {item.description && (
              <p className="mt-1.5 text-[0.95rem] leading-relaxed opacity-80">{item.description}</p>
            )}
            {item.priceFrom && (
              <p className="mt-3 font-semibold text-[var(--brand-accent-text-surface)]">
                {item.priceFrom}
                <span className="ml-1 text-xs font-normal opacity-60">incl. GST</span>
              </p>
            )}
          </div>
        ))}
      </Grid>
    </>
  )
}

/* ---------------------------------------------------------------- imageText */

export function ImageText({ variant, props }: Of<'imageText'>, id?: string) {
  const reversed = variant === 'right'
  // A two-column layout with nothing in the second column leaves the copy stranded in
  // half the width. Most generated sites start with no photos, so this is the common
  // case, not the edge case.
  const twoUp = variant !== 'stacked' && Boolean(props.image)

  return (
    <div
      className={twoUp ? 'grid items-center gap-8 md:grid-cols-2 md:gap-12' : 'mx-auto max-w-[62ch]'}
    >
      {twoUp && props.image && (
        <Image
          image={props.image}
          sizes="(max-width: 768px) 100vw, 45vw"
          className={`aspect-[4/3] w-full rounded-[var(--radius)] shadow-[var(--shadow)] ${reversed ? 'md:order-2' : ''}`}
        />
      )}
      <div>
        <Heading id={id}>{props.heading}</Heading>
        <div className="mt-3 space-y-3 leading-relaxed opacity-85">
          {props.body.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        {props.cta && (
          <div className="mt-6">
            <Button cta={props.cta} />
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- testimonials */

/**
 * Every item carries source: 'customer_supplied' — the schema permits no other value.
 * The AI cannot author a testimonial, so anything rendered here was given to us by the
 * business owner. See docs/00-PRD.md §7.
 */
export function Testimonials({ variant, props }: Of<'testimonials'>, id?: string) {
  const quote = variant === 'quote'
  return (
    <>
      {props.heading && <Heading id={id}>{props.heading}</Heading>}
      <div
        className={
          quote
            ? 'mx-auto mt-8 max-w-[52ch] text-center'
            : 'mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
        }
      >
        {props.items.map((t, i) => (
          <figure
            key={i}
            className={
              quote
                ? ''
                : 'rounded-[var(--radius)] bg-white/70 p-5 shadow-[var(--shadow)] ring-1 ring-black/5'
            }
          >
            {typeof t.rating === 'number' && (
              <p className="mb-2 text-[var(--brand-accent-text-surface)]">
                {/* aria-label is prohibited on a <p> — ARIA only allows it on elements
                    with a role that supports naming. Screen readers get real text. */}
                <span className="sr-only">{t.rating} out of 5 stars.</span>
                <span aria-hidden="true">{'★'.repeat(t.rating)}</span>
              </p>
            )}
            <blockquote className={quote ? 'font-heading text-xl leading-snug' : 'leading-relaxed'}>
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-3 text-sm opacity-70">
              {t.author}
              {t.location && <span>, {t.location}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  )
}

/* -------------------------------------------------------------------- contact */

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-xs font-semibold tracking-[0.1em] uppercase opacity-55">{label}</dt>
      <dd className="mt-0.5 text-[1.02rem]">{children}</dd>
    </div>
  )
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

export function Contact(
  { variant, props }: Of<'contact'>,
  id: string | undefined,
  business: BusinessFacts,
) {
  const addr = business.address
  const split = variant === 'split' || variant === 'map-split'

  const details = (
    <dl className="divide-y divide-current/10">
      {props.showPhone && business.phone && (
        <Detail label="Phone">
          <a href={telHref(business.phone)} className="font-semibold no-underline hover:underline">
            {business.phone}
          </a>
        </Detail>
      )}
      {props.showEmail && business.email && (
        <Detail label="Email">
          <a href={`mailto:${business.email}`} className="no-underline hover:underline">
            {business.email}
          </a>
        </Detail>
      )}
      {props.showAddress && addr?.line1 && (
        <Detail label="Address">
          <address className="not-italic">
            {addr.line1}
            {addr.suburb && <>, {addr.suburb}</>}
            {addr.state && <> {addr.state}</>}
            {addr.postcode && <> {addr.postcode}</>}
          </address>
        </Detail>
      )}
      {props.showServiceAreas && business.serviceAreas.length > 0 && (
        <Detail label="Areas we cover">{business.serviceAreas.join(' &middot; ')}</Detail>
      )}
      {props.showHours && business.openingHours && (
        <Detail label="Opening hours">
          <ul className="space-y-0.5">
            {DAYS.map((d) => {
              const h = business.openingHours?.[d]
              return (
                <li key={d} className="flex justify-between gap-6 text-[0.95rem]">
                  <span className="capitalize">{d}</span>
                  <span className="tabular-nums opacity-80">
                    {h ? `${h.open} – ${h.close}` : 'Closed'}
                  </span>
                </li>
              )
            })}
          </ul>
        </Detail>
      )}
    </dl>
  )

  return (
    <>
      {props.heading && <Heading id={id}>{props.heading}</Heading>}
      {props.subheading && <Lede>{props.subheading}</Lede>}
      <div className={split ? 'mt-7 grid gap-8 md:grid-cols-2 md:gap-12' : 'mt-7 max-w-[46ch]'}>
        {details}
        {variant === 'map-split' && addr?.lat && addr.lng && (
          <iframe
            title={`Map showing ${business.businessName}`}
            loading="lazy"
            className="h-64 w-full rounded-[var(--radius)] border-0 md:h-full"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${addr.lng - 0.01}%2C${addr.lat - 0.008}%2C${addr.lng + 0.01}%2C${addr.lat + 0.008}&layer=mapnik&marker=${addr.lat}%2C${addr.lng}`}
          />
        )}
      </div>
      {props.note && <p className="mt-5 text-sm opacity-70">{props.note}</p>}
    </>
  )
}

/* ------------------------------------------------------------------------ cta */

export function Cta({ variant, props }: Of<'cta'>, id?: string) {
  const centred = variant !== 'split'
  return (
    <div
      className={
        variant === 'split'
          ? 'flex flex-col items-start justify-between gap-6 md:flex-row md:items-center'
          : 'mx-auto max-w-[46ch] text-center'
      }
    >
      <div>
        <Heading id={id}>{props.heading}</Heading>
        {props.subheading && <Lede>{props.subheading}</Lede>}
      </div>
      <div className={`mt-6 flex flex-wrap gap-3 md:mt-0 ${centred ? 'justify-center' : ''}`}>
        <Button cta={props.primaryCta} />
        {props.secondaryCta && <Button cta={props.secondaryCta} tone="ghost" />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ registry */

/**
 * An unknown type renders nothing rather than throwing. During a rolling deploy an old
 * renderer will meet a spec containing a component it does not know; omitting one
 * section is survivable, 500-ing every request for that tenant is not.
 */
export function renderSection(section: SectionSpec, business: BusinessFacts, headingId?: string) {
  switch (section.type) {
    case 'hero':
      return <Hero {...section} />
    case 'services':
      return Services(section, headingId)
    case 'imageText':
      return ImageText(section, headingId)
    case 'testimonials':
      return Testimonials(section, headingId)
    case 'countdown':
      return <Countdown {...section.props} headingId={headingId} />
    case 'contact':
      return Contact(section, headingId, business)
    case 'contactForm':
      return <ContactForm {...section.props} headingId={headingId} />
    case 'cta':
      return Cta(section, headingId)
    default:
      return null
  }
}
