import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { rawPrisma } from '@awning/db'

/**
 * F-07 -- authentication.
 *
 * Better Auth rather than a rolled-own: session handling, credential hashing, OAuth
 * and email verification are all places where a subtle mistake is a breach, and none
 * of them are our product. Self-hosted rather than Clerk so there is no per-MAU fee
 * and no Australian data-residency problem (docs/02-ARCHITECTURE.md §3).
 *
 * The model mapping exists because our schema predates this. Without it Better Auth
 * creates its own `user` table, leaving two identities per person and a join on every
 * request. One users table, mapped onto the names it expects.
 */
export const auth = betterAuth({
  appName: 'Awning',
  baseURL: process.env.APP_URL ?? 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET,

  database: prismaAdapter(rawPrisma, { provider: 'postgresql' }),

  advanced: {
    database: {
      // Better Auth generates short random ids by default. Our users.id is uuid and is
      // the FK target for organizations, sites and everything downstream, so ids must
      // be uuids or the very first insert fails.
      generateId: () => randomUUID(),
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    requireEmailVerification: false, // flipped on once Resend is wired (week 6)
  },

  user: {
    modelName: 'users',
    fields: {
      emailVerified: 'email_verified',
      image: 'avatar_url',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  session: {
    modelName: 'auth_sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24, // rewrite the row at most daily, not on every request
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  account: {
    modelName: 'auth_accounts',
    fields: {
      userId: 'user_id',
      accountId: 'provider_account_id',
      providerId: 'provider',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  verification: {
    modelName: 'auth_verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  trustedOrigins: [process.env.APP_URL ?? 'http://localhost:3000'],
})

export type Auth = typeof auth
export type Session = Auth['$Infer']['Session']
