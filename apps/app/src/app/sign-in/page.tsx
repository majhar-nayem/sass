export const dynamic = 'force-dynamic'

/** Placeholder until the real onboarding lands in P-01 (week 3). */
export default function SignIn() {
  return (
    <main style={{ maxWidth: 380, margin: '15vh auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '.4rem' }}>Sign in to Awning</h1>
      <p style={{ opacity: 0.7, lineHeight: 1.6, marginTop: 0 }}>
        Email and password sign-in is live at <code>/api/auth</code>. The onboarding flow
        (P-01) replaces this page in week 3.
      </p>
    </main>
  )
}
