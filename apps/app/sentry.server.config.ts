import * as Sentry from '@sentry/nextjs'
import { scrubEvent, setErrorReporter } from '@awning/integrations/observability'

/**
 * F-11 -- Sentry, server side.
 *
 * Without a DSN this is inert: no client, no network, no warning noise. That is the
 * normal state in development and it must not change behaviour.
 */
const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.FLY_MACHINE_VERSION ?? process.env.GIT_SHA,

    // A tradie's enquiry form carries a customer's name, phone and address. Those
    // belong to that customer, not to us, and they must not be forwarded to an error
    // tracker — so PII is off, and the scrubber runs over everything anyway.
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

    // The privacy boundary, kept in one tested place rather than duplicated here.
    beforeSend: (event) => scrubEvent(event),

    beforeBreadcrumb(crumb) {
      // Query breadcrumbs echo SQL parameters, which is customer data by another route.
      if (crumb.category === 'query' || crumb.category === 'http') crumb.data = undefined
      return crumb
    },
  })

  // Everything funnels through reportError, so it needs somewhere to send.
  setErrorReporter((error, { tags, extra }) => {
    Sentry.withScope((scope) => {
      scope.setTags(tags)
      scope.setExtras(extra)
      Sentry.captureException(error)
    })
  })
}
