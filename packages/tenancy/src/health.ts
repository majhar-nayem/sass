import { appPrisma, rawPrisma } from '@awning/db'
import { pingCache } from './resolve.js'

/**
 * F-06 -- two depths, for two different questions.
 *
 * Shallow answers "is this process alive", which is what Fly's frequent check needs: it
 * must not fail because a dependency blipped, or a database hiccup would mark every
 * machine unhealthy at once.
 *
 * Deep answers "can this machine actually serve", which is what a DEPLOY needs. A new
 * machine with a wrong connection string passes a shallow check and then fails every
 * request. Checking both roles matters specifically: the owner role working proves
 * nothing about awning_app, and it is awning_app that every authenticated request uses.
 */
export interface DeepHealth {
  ok: boolean
  service: string
  checks: { ownerDb: string; appDb: string; cache: string }
  ms: number
}

const probe = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn()
    return 'ok'
  } catch (e) {
    return `failed: ${(e as Error).message.split('\n')[0]?.slice(0, 120)}`
  }
}

export async function deepHealth(service: string): Promise<DeepHealth> {
  const started = Date.now()
  const [ownerDb, appDb, cache] = await Promise.all([
    probe(() => rawPrisma.$queryRaw`SELECT 1`),
    probe(() => appPrisma.$queryRaw`SELECT 1`),
    pingCache(),
  ])
  return {
    ok: ownerDb === 'ok' && appDb === 'ok' && cache !== 'unreachable',
    service,
    checks: { ownerDb, appDb, cache },
    ms: Date.now() - started,
  }
}
