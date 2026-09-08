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
 * Non-owner client used by every authenticated request. RLS applies to this role,
 * so a query that forgets its org filter returns zero rows rather than another
 * tenant's data.
 */
export const appPrisma =
  globalForPrisma.appPrisma ??
  new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.rawPrisma = rawPrisma
  globalForPrisma.appPrisma = appPrisma
}

export type { PrismaClient }
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>
