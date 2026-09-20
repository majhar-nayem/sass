import { redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { currentUser } from '@/lib/session'
import { Wizard } from './wizard'

export const dynamic = 'force-dynamic'
const createCaller = createCallerFactory(appRouter)

export default async function OnboardingPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  // Already set up: send them to the editor rather than letting them make a second org.
  const membership = await caller.org.current()
  if (membership) {
    const sites = await caller.site.list()
    if (sites[0]) redirect(`/editor/${sites[0].id}`)
  }

  const draft = await caller.onboarding.draft()
  return <Wizard initial={draft.answers as never} initialStep={draft.step} />
}
