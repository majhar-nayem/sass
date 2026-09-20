import { redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const createCaller = createCallerFactory(appRouter)

export default async function Dashboard() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  // Server-side calls go through the same router as the HTTP API, so they get the same
  // orgProcedure checks. There is no privileged back door for our own UI.
  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  const membership = await caller.org.current()
  // No business yet means they never finished onboarding; that is the only useful
  // thing this page can offer them.
  if (!membership) redirect('/onboarding')
  const sites = await caller.site.list()

  return (
    <main style={{ maxWidth: 760, margin: '6vh auto', padding: '0 24px' }}>
      <header style={{ borderBottom: '1px solid #D5D8D1', paddingBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Your website</h1>
        <p style={{ opacity: 0.65, margin: '.3rem 0 0', fontSize: '.9rem' }}>
          Signed in as {user.email}
        </p>
      </header>

      {(
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1.6rem' }}>
          {sites.map((s) => (
            <li
              key={s.id}
              style={{
                border: '1px solid #D5D8D1',
                borderRadius: 6,
                padding: '1rem 1.1rem',
                marginBottom: '.8rem',
                background: '#fff',
              }}
            >
              <strong>{s.name}</strong>
              <div style={{ fontSize: '.85rem', opacity: 0.7, marginTop: '.25rem' }}>
                {s.slug}.awningsites.localhost · {s.status}
              </div>
              <a href={`/editor/${s.id}`} style={{ fontSize: '.9rem' }}>Open editor</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
