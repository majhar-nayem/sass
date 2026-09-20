import * as Sentry from '@sentry/nextjs'

// Middleware runs on the edge runtime, which has no node:async_hooks — so no shared
// context module here, just the minimum needed to see a middleware failure.
const dsn = process.env.SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  })
}
