import { notFound, redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { cnameTarget } from '@awning/integrations/cloudflare'
import { currentUser } from '@/lib/session'
import { Domains } from './domains'

export const dynamic = 'force-dynamic'
const createCaller = createCallerFactory(appRouter)

export default async function DomainsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { siteId } = await params
  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  const site = await caller.site.get({ siteId }).catch(() => null)
  if (!site) notFound()

  const domains = await caller.domain.list({ siteId })
  return (
    <Domains
      siteId={siteId}
      siteName={site.name}
      cnameTarget={cnameTarget()}
      domains={domains.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        kind: d.kind,
        status: d.status,
        isPrimary: d.is_primary,
        problem: d.error_message_human,
        txt: d.verification_txt,
      }))}
    />
  )
}
