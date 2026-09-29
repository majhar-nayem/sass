import { notFound, redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { currentUser } from '@/lib/session'
import { Fulfilment } from './fulfilment'

export const dynamic = 'force-dynamic'
const createCaller = createCallerFactory(appRouter)

export default async function FulfilmentPage({ params }: { params: Promise<{ siteId: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')
  const { siteId } = await params
  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  const site = await caller.site.get({ siteId }).catch(() => null)
  if (!site) notFound()
  return <Fulfilment siteId={siteId} siteName={site.name} initial={await caller.store.fulfilment({ siteId })} />
}
