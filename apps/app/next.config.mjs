import path from 'node:path'
import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Ships a self-contained server with only the files actually traced as reachable.
  // outputFileTracingRoot must be the workspace root or the trace stops at the app
  // directory and every @awning/* package is left out of the image.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@awning/api', '@awning/auth', '@awning/db', '@awning/spec', '@awning/tenancy', '@awning/ai', '@awning/integrations'],
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'ioredis', 'better-auth', 'sharp', 'nodemailer'],
  eslint: { ignoreDuringBuilds: true }, // eslint.config.js at the root is authoritative
  webpack(config, { isServer }) {
    // Our source uses NodeNext-style ".js" specifiers pointing at ".ts" files.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] }
    // serverExternalPackages does not reach a native module imported through a
    // TRANSPILED workspace package, so sharp gets bundled and its platform binary
    // cannot be resolved. Externalise it explicitly.
    if (isServer) config.externals = [...(config.externals ?? []), 'sharp', 'nodemailer']
    return config
  },
}

// Source maps are uploaded only when there is somewhere to upload them to, so a build
// without Sentry credentials is a normal build and not a warning storm.
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      // Strip them after upload: a stack trace readable in Sentry, nothing served to
      // the public that maps our bundles back to source.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      disableLogger: true,
    })
  : config
