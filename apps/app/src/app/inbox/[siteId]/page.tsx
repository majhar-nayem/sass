import { notFound, redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { currentUser } from '@/lib/session'
import { Inbox } from './inbox'

export const dynamic = 'force-dynamic'
const createCaller = createCallerFactory(appRouter)

export default async function InboxPage({ params }: { params: Promise<{ siteId: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { siteId } = await params
  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  const site = await caller.site.get({ siteId }).catch(() => null)
  if (!site) notFound()

  const leads = await caller.lead.list({ siteId, includeSpam: false })
  return (
    <Inbox
      siteId={siteId}
      siteName={site.name}
      leads={leads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        message: l.message,
        createdAt: l.created_at.toISOString(),
        read: l.read_at !== null,
      }))}
    />
  )
}
