import * as Sentry from '@sentry/nextjs'

/**
 * F-11 -- browser errors in the dashboard.
 *
 * No session replay: the editor holds the customer's own business content and their
 * enquiry inbox, which is other people's personal information.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      delete event.user
      if (event.request) delete event.request.query_string
      return event
    },
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
