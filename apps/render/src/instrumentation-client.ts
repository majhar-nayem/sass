import * as Sentry from '@sentry/nextjs'
import { setSectionErrorReporter } from '@awning/ui-blocks'

/**
 * F-11 -- browser errors on tenant websites.
 *
 * This runs in the browser of every visitor to every customer's site, so it is kept
 * minimal: no session replay (it would record what a member of the public types into
 * an enquiry form), no PII, and a low trace rate because those visitors are not ours
 * to profile.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    sendDefaultPii: false,
    tracesSampleRate: 0.02,
    beforeSend(event) {
      delete event.user
      if (event.request) delete event.request.query_string
      return event
    },
  })

  // A section that throws hides itself and the rest of the page keeps working, so the
  // failure leaves no trace at all. This is the only way we hear about it — otherwise
  // the first report is a customer ringing to say their reviews have disappeared.
  setSectionErrorReporter((error, info) => {
    Sentry.withScope((scope) => {
      scope.setTags({ section_id: info.sectionId, section_type: info.type })
      Sentry.captureException(error)
    })
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
