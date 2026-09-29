import { notFound, redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { currentUser } from '@/lib/session'
import { Payments } from './payments'

export const dynamic = 'force-dynamic'
const createCaller = createCallerFactory(appRouter)

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ stripe?: string }>
}) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { siteId } = await params
  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  const site = await caller.site.get({ siteId }).catch(() => null)
  if (!site) notFound()

  /**
   * Coming back from Stripe is a plain redirect and proves nothing: the owner reaches
   * it by finishing, by pressing back, or by abandoning the form. So the return asks
   * Stripe what is actually true instead of believing the URL.
   */
  const returning = (await searchParams).stripe === 'return'
  const payments = returning
    ? await caller.store.syncPayments({ siteId })
    : await caller.store.payments({ siteId })

  return (
    <Payments
      siteId={siteId}
      siteName={site.name}
      initial={{
        state: payments.state,
        currentlyDue: payments.currentlyDue,
        disabledReason: payments.disabledReason,
        canAcceptPayments: payments.canAcceptPayments,
      }}
      justReturned={returning}
    />
  )
}
