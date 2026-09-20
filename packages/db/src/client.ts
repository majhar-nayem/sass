import { PrismaClient } from '@prisma/client'

/**
 * Owner-role client. Runs migrations, the seed, and the RENDERER.
 * Postgres exempts a table owner from RLS, which the renderer needs: it resolves a
 * tenant from the Host header before any org context exists.
 *
 * App code must NOT import this — the lint rule in eslint.config.js blocks it.
 * Use withOrgContext instead.
 */
const globalForPrisma = globalThis as unknown as {
  rawPrisma?: PrismaClient
  appPrisma?: PrismaClient
}

export const rawPrisma =
  globalForPrisma.rawPrisma ?? new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })

/**
 * Which connection the request-path client uses.
 *
 * Falling back to DATABASE_URL is a convenience in development, where one role is
 * enough to get a database running. In production it is a silent catastrophe: the owner
 * role is RLS-exempt, so an unset APP_DATABASE_URL turns every tenant boundary in the
 * product off at once, and nothing looks wrong until one customer sees another's data.
 * The isolation suite would still pass, because it sets the variable itself.
 *
 * So in production this is a hard failure at boot. A container that cannot enforce RLS
 * must never take traffic — Fly's health gate then holds the old machines in place.
 * The build is exempt: `next build` runs with NODE_ENV=production and no secrets.
 */
export function resolveAppDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const app = env.APP_DATABASE_URL
  const owner = env.DATABASE_URL
  const isBuild = env.NEXT_PHASE === 'phase-production-build'

  if (env.NODE_ENV === 'production' && !isBuild) {
    if (!app)
      throw new Error(
        'APP_DATABASE_URL is not set. Request code would connect as the owner role, which ' +
          'Postgres exempts from row-level security, disabling every tenant boundary. ' +
          'Set it to the awning_app connection string.',
      )
    if (app === owner)
      throw new Error(
        'APP_DATABASE_URL is the same connection string as DATABASE_URL. The request path ' +
          'must connect as awning_app, not as the owner role, or row-level security does ' +
          'not apply to it.',
      )
  }
  return app ?? owner
}

/**
 * Non-owner client used by every authenticated request. RLS applies to this role,
 * so a query that forgets its org filter returns zero rows rather than another
 * tenant's data.
 */
export const appPrisma =
  globalForPrisma.appPrisma ?? new PrismaClient({ datasourceUrl: resolveAppDatabaseUrl() })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.rawPrisma = rawPrisma
  globalForPrisma.appPrisma = appPrisma
}

export type { PrismaClient }
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>
