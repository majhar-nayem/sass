'use client'
import { useState } from 'react'
import type { BusinessFacts, WebsiteSpec } from '@awning/spec'
import { telHref, whatsappHref } from '@awning/spec'
import { Button } from './primitives.js'

/* ------------------------------------------------------------- announcement */

export function AnnouncementBar({
  bar,
}: {
  bar: NonNullable<NonNullable<WebsiteSpec['globals']>['announcementBar']>
}) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  if (bar.endsAt && new Date(bar.endsAt) < new Date()) return null

  const tone =
    bar.variant === 'urgent'
      ? 'bg-brand-accent text-brand-on-accent'
      : bar.variant === 'festive'
        ? 'bg-brand text-brand-on-primary'
        : 'bg-brand text-brand-on-primary'

  return (
    <div className={`${tone} px-4 py-2.5 text-center text-sm`}>
      <div className="mx-auto flex max-w-[1100px] items-center justify-center gap-3">
        {bar.href ? (
          <a href={bar.href} className="font-medium underline-offset-2 hover:underline">
            {bar.text}
          </a>
        ) : (
          <span className="font-medium">{bar.text}</span>
        )}
        {bar.dismissible && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss announcement"
            className="-my-1 ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-70 hover:opacity-100"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- navbar */

export function Navbar({
  nav,
  site,
  business,
}: {
  nav: WebsiteSpec['nav']
  site: WebsiteSpec['site']
  business: BusinessFacts
}) {
  const [open, setOpen] = useState(false)
  const items = nav?.items ?? []
  const showPhone = nav?.showPhone !== false && business.phone

  return (
    <header className="sticky top-0 z-40 border-b border-current/10 bg-[var(--brand-surface)]/90 backdrop-blur-sm">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-[1100px] items-center gap-4 px-5 py-3 md:px-8"
      >
        <a
          href="/"
          className="-mx-2 flex min-h-11 items-center px-2 font-heading text-lg font-bold no-underline"
        >
          {site.businessName}
        </a>

        <ul className="ml-auto hidden items-center gap-6 md:flex">
          {items.map((i) => (
            <li key={i.href}>
              <a href={i.href} className="text-[0.95rem] no-underline hover:underline">
                {i.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {showPhone && (
            <a
              href={telHref(business.phone!)}
              className="hidden min-h-11 items-center rounded-[var(--radius)] px-3 font-semibold no-underline md:inline-flex"
            >
              {business.phone}
            </a>
          )}
          {/* Wrapped rather than passing `hidden` to Button: Button hardcodes
              `inline-flex`, and two display utilities of equal specificity are decided
              by stylesheet order, not by which one you wrote last. */}
          {nav?.cta && (
            <span className="hidden md:block">
              <Button cta={nav.cta} />
            </span>
          )}

          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] md:hidden"
            >
              <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          )}
        </div>
      </nav>

      {open && (
        <ul id="mobile-menu" className="border-t border-current/10 px-5 pb-3 md:hidden">
          {items.map((i) => (
            <li key={i.href}>
              <a
                href={i.href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center no-underline"
              >
                {i.label}
              </a>
            </li>
          ))}
          {showPhone && (
            <li>
              <a
                href={telHref(business.phone!)}
                className="flex min-h-12 items-center font-semibold no-underline"
              >
                {business.phone}
              </a>
            </li>
          )}
        </ul>
      )}
    </header>
  )
}

/* -------------------------------------------------------------------- footer */

const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
}

export function Footer({
  footer,
  site,
  business,
}: {
  footer: WebsiteSpec['footer']
  site: WebsiteSpec['site']
  business: BusinessFacts
}) {
  const year = new Date().getFullYear()
  const socials = Object.entries(business.socials ?? {}).filter(([, v]) => v)

  return (
    <footer className="border-t border-current/10 bg-brand-surface px-5 py-10 md:px-8">
      <div className="mx-auto grid max-w-[1100px] gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-heading text-lg font-bold">{site.businessName}</p>
          {business.address?.suburb && (
            <address className="mt-1.5 text-sm not-italic opacity-75">
              {business.address.suburb}
              {business.address.state && <>, {business.address.state}</>}
            </address>
          )}
          {footer?.showServiceAreas && business.serviceAreas.length > 0 && (
            <p className="mt-3 max-w-[40ch] text-sm leading-relaxed opacity-75">
              Servicing {business.serviceAreas.join(', ')}.
            </p>
          )}
        </div>

        <div className="text-sm">
          {business.phone && (
            <p className="py-1">
              <a href={telHref(business.phone)} className="font-semibold no-underline hover:underline">
                {business.phone}
              </a>
            </p>
          )}
          {business.email && (
            <p className="py-1">
              <a href={`mailto:${business.email}`} className="no-underline hover:underline">
                {business.email}
              </a>
            </p>
          )}
        </div>

        <div className="text-sm">
          {socials.length > 0 && (
            <ul className="flex flex-wrap gap-4">
              {socials.map(([k, url]) => (
                <li key={k}>
                  <a href={url} rel="me noopener" className="no-underline hover:underline">
                    {SOCIAL_LABELS[k] ?? k}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {footer?.legalLinks !== false && (
            <ul className="mt-4 space-y-1 opacity-75">
              <li>
                <a href="/privacy" className="no-underline hover:underline">
                  Privacy policy
                </a>
              </li>
            </ul>
          )}
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-[1100px] flex-wrap gap-x-4 gap-y-1 border-t border-current/10 pt-5 text-xs opacity-60">
        <span>
          &copy; {year} {site.businessName}
        </span>
        {/* Displaying the ABN is standard practice for an Australian business and is
            only ever the number the owner entered — never one the model invented. */}
        {site.showAbnInFooter && business.abn && <span>ABN {formatAbn(business.abn)}</span>}
      </div>
    </footer>
  )
}

/** 51824753556 -> 51 824 753 556, the way the ABR prints it. */
function formatAbn(abn: string): string {
  const d = abn.replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn
}

/* ------------------------------------------------------------ mobile CTAs */

/**
 * Fixed to the bottom of the screen on phones only. For a trade this is consistently
 * the highest-converting element on the page: the visitor is outdoors, one-handed, and
 * wants to talk to someone rather than read.
 */
export function StickyCallBar({ label, phone }: { label?: string; phone: string }) {
  return (
    <>
      <a
        href={telHref(phone)}
        className="fixed inset-x-0 bottom-0 z-50 flex min-h-14 items-center justify-center gap-2 bg-brand-accent font-semibold text-brand-on-accent no-underline md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {label ?? `Call ${phone}`}
      </a>
      {/* Reserve the space so the bar never covers the end of the page. */}
      <div aria-hidden="true" className="h-14 md:hidden" />
    </>
  )
}

export function WhatsAppBubble({ number, prefill }: { number: string; prefill?: string }) {
  return (
    <a
      href={whatsappHref(number, prefill)}
      rel="noopener"
      className="fixed right-4 bottom-20 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg md:bottom-6"
    >
      <span className="sr-only">Message us on WhatsApp</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.4 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c2.1.8 2.1.6 2.5.5a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" />
      </svg>
    </a>
  )
}
