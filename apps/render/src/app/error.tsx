'use client'

/**
 * Reached when a published spec no longer renders — a schema change that got past the
 * validation gate and reached a live customer site. It returns a 500 on purpose: this
 * is our bug, it should page someone, and it must not look like a normal empty page.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
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
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 .7rem', fontWeight: 600 }}>
        This website is temporarily unavailable.
      </h1>
      <p style={{ lineHeight: 1.65, opacity: 0.7 }}>
        We&rsquo;ve been alerted and are looking at it. Please try again shortly.
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: '1rem',
          padding: '.6rem 1.2rem',
          border: '1.5px solid currentColor',
          background: 'transparent',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  )
}
