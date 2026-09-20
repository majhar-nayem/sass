/**
 * F-06 -- refuse to start rather than start wrong.
 *
 * Next runs this once, before the server accepts a request. The connection-role check
 * is otherwise lazy: nothing imports the database client until the first request that
 * needs it, so a machine missing APP_DATABASE_URL boots, passes the shallow health
 * check, joins the pool and only then fails — having already been declared healthy.
 *
 * Exiting here means the machine never enters the pool at all and Fly holds the
 * previous release in place.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    // The import itself throws: the client is constructed at module scope. Next would
    // otherwise report "failed to prepare server" and leave the process up answering
    // 500s, which is a machine that looks alive to everything except a request.
    const { resolveAppDatabaseUrl } = await import('@awning/db')
    resolveAppDatabaseUrl()
  } catch (e) {
    console.error('[startup] refusing to start: ' + (e as Error).message)
    process.exit(1)
  }
}
