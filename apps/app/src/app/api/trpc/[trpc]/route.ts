import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@awning/api'
import { auth } from '@awning/auth'
import { withoutOrgContext } from '@awning/db'

async function createContext(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers })
  const userId = session?.user?.id ?? null

  let isPlatformAdmin = false
  if (userId) {
    const u = await withoutOrgContext('session', (db) =>
      db.users.findUnique({ where: { id: userId }, select: { is_platform_admin: true } }),
    )
    isPlatformAdmin = u?.is_platform_admin ?? false
  }

  return {
    userId,
    isPlatformAdmin,
    // Honoured only after membership is verified in orgProcedure, never trusted as-is.
    requestedOrgId: req.headers.get('x-awning-org') ?? undefined,
    ip: req.headers.get('x-forwarded-for') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }
}

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError({ error, path }) {
      if (error.code === 'INTERNAL_SERVER_ERROR')
        console.error(`[trpc] ${path ?? '<no path>'}`, error.message)
    },
  })
}

export { handler as GET, handler as POST }
