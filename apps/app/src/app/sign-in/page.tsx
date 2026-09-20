export const dynamic = 'force-dynamic'

/** Placeholder until the real sign-in form lands with P-12; the API behind it is live. */
export default function SignIn() {
  return (
    <main className="mx-auto max-w-sm px-5 py-[15vh]">
      <h1 className="text-2xl font-semibold">Sign in to Awning</h1>
      <p className="mt-2 leading-relaxed text-muted">
        Email and password sign-in is live at <code>/api/auth</code>. Once you&rsquo;re
        signed in you&rsquo;ll land on the seven-question setup, and your website is built
        from your answers.
      </p>
    </main>
  )
}
