import * as Sentry from '@sentry/nextjs'

/**
 * Runs once, before the server accepts a request.
 *
 * F-11 initialises error reporting first, so that F-06's startup guard below can
 * itself be reported: a machine that refuses to boot in production is exactly the
 * event someone needs to see, and the alternative is discovering it in a deploy log.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config.js')
    return
  }
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  await import('../sentry.server.config.js')

  /**
   * F-06 -- refuse to start rather than start wrong.
   *
   * The connection-role check is otherwise lazy: nothing imports the database client
   * until the first request that needs it, so a machine missing APP_DATABASE_URL boots,
   * passes the shallow health check, joins the pool and only then fails — having
   * already been declared healthy. Exiting here means it never enters the pool and Fly
   * holds the previous release in place.
   */
  try {
    // The import itself throws: the client is constructed at module scope. Next would
    // otherwise report "failed to prepare server" and leave the process up answering
    // 500s, which is a machine that looks alive to everything except a request.
    const { resolveAppDatabaseUrl } = await import('@awning/db')
    resolveAppDatabaseUrl()
  } catch (e) {
    console.error('[startup] refusing to start: ' + (e as Error).message)
    Sentry.captureException(e, { tags: { service: 'app', phase: 'startup' } })
    await Sentry.flush(2000).catch(() => {})
    process.exit(1)
  }
}

/**
 * Every uncaught error from a route, tagged with the tenant it happened to.
 *
 * "Something threw" is not actionable when fifty businesses share a renderer.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  const { currentContext } = await import('@awning/integrations/observability')
  const ctx = currentContext()
  Sentry.withScope((scope) => {
    scope.setTags({
      service: 'app',
      route: context.routePath,
      ...(ctx?.orgId ? { org_id: ctx.orgId } : {}),
      ...(ctx?.siteId ? { site_id: ctx.siteId } : {}),
    })
    if (ctx?.requestId) scope.setExtra('request_id', ctx.requestId)
    Sentry.captureRequestError(err, request as never, context as never)
  })
}
