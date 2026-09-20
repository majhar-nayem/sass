import { describe, expect, it } from 'vitest'
import { resolveAppDatabaseUrl } from '../client.js'

/**
 * F-06. The request path must connect as awning_app, never as the owner role.
 *
 * Postgres exempts a table owner from RLS, so if this falls back in production every
 * tenant boundary in the product is off simultaneously — and the isolation suite would
 * not catch it, because the suite sets APP_DATABASE_URL itself.
 */
const OWNER = 'postgresql://owner@host/db'
const APP = 'postgresql://awning_app@host/db'

describe('production', () => {
  const prod = (over: Record<string, string | undefined>) =>
    ({ NODE_ENV: 'production', DATABASE_URL: OWNER, ...over }) as NodeJS.ProcessEnv

  it('refuses to start when APP_DATABASE_URL is missing', () => {
    expect(() => resolveAppDatabaseUrl(prod({}))).toThrow(/row-level security/i)
  })

  // The subtler misconfiguration: the variable is set, but to the owner's string.
  it('refuses to start when it is the owner connection string', () => {
    expect(() => resolveAppDatabaseUrl(prod({ APP_DATABASE_URL: OWNER }))).toThrow(/owner role/i)
  })

  it('accepts a distinct app connection string', () => {
    expect(resolveAppDatabaseUrl(prod({ APP_DATABASE_URL: APP }))).toBe(APP)
  })

  // next build runs with NODE_ENV=production and no secrets; it must not be blocked.
  it('does not block the production build', () => {
    const env = prod({ NEXT_PHASE: 'phase-production-build' })
    expect(() => resolveAppDatabaseUrl(env)).not.toThrow()
  })
})

describe('development', () => {
  it('still falls back to one database, which is the point of one database', () => {
    const env = { NODE_ENV: 'development', DATABASE_URL: OWNER } as NodeJS.ProcessEnv
    expect(resolveAppDatabaseUrl(env)).toBe(OWNER)
  })

  it('prefers the app url when both are present', () => {
    const env = { NODE_ENV: 'test', DATABASE_URL: OWNER, APP_DATABASE_URL: APP } as NodeJS.ProcessEnv
    expect(resolveAppDatabaseUrl(env)).toBe(APP)
  })
})
