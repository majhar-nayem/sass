import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Site not found', robots: { index: false, follow: false } }

/**
 * A wildcard domain gets a lot of traffic for hosts that are not sites: scanners,
 * half-configured custom domains, and subdomains someone typed wrong. This is a
 * marketing surface, not a stack trace — and it must return a real 404 so Google
 * does not index thousands of thin pages under awningsites.com.
 */
export default function NotFound() {
  return (
    <div
      style={{
        maxWidth: 460,
        margin: '18vh auto',
        padding: '0 24px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#1B2A33',
      }}
    >
      <h1 style={{ fontSize: '1.35rem', margin: '0 0 .7rem', fontWeight: 600 }}>
        There&rsquo;s no website here yet.
      </h1>
      <p style={{ lineHeight: 1.65, opacity: 0.7, margin: 0 }}>
        If this is your domain, you can build a site on it in about twenty minutes at{' '}
        <a href="https://awning.au" style={{ color: '#B8431F' }}>
          awning.au
        </a>
        .
      </p>
    </div>
  )
}
