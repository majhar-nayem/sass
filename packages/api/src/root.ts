import { router, publicProcedure } from './trpc.js'
import { siteRouter } from './routers/site.js'
import { leadRouter } from './routers/lead.js'
import { orgRouter } from './routers/org.js'
import { aiRouter } from './routers/ai.js'

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  org: orgRouter,
  site: siteRouter,
  lead: leadRouter,
  ai: aiRouter,
})

export type AppRouter = typeof appRouter
