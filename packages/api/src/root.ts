import { router, publicProcedure } from './trpc.js'
import { siteRouter } from './routers/site.js'
import { leadRouter } from './routers/lead.js'
import { orgRouter } from './routers/org.js'
import { aiRouter } from './routers/ai.js'
import { onboardingRouter } from './routers/onboarding.js'
import { billingRouter } from './routers/billing.js'
import { domainRouter } from './routers/domain.js'
import { adminRouter } from './routers/admin.js'
import { productRouter } from './routers/product.js'

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  org: orgRouter,
  site: siteRouter,
  lead: leadRouter,
  ai: aiRouter,
  onboarding: onboardingRouter,
  billing: billingRouter,
  domain: domainRouter,
  admin: adminRouter,
  product: productRouter,
})

export type AppRouter = typeof appRouter
