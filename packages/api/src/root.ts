import { router, publicProcedure } from './trpc.js'
import { siteRouter } from './routers/site.js'
import { leadRouter } from './routers/lead.js'
import { orgRouter } from './routers/org.js'
import { aiRouter } from './routers/ai.js'
import { onboardingRouter } from './routers/onboarding.js'

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  org: orgRouter,
  site: siteRouter,
  lead: leadRouter,
  ai: aiRouter,
  onboarding: onboardingRouter,
})

export type AppRouter = typeof appRouter
