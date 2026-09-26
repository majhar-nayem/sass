/**
 * F-11 -- a reporting seam for the browser.
 *
 * ui-blocks runs in a visitor's browser, so it cannot use the server observability
 * module (AsyncLocalStorage does not exist there) and should not carry a Sentry
 * dependency of its own. The app registers a reporter; unregistered, this is a no-op
 * and the boundary still does its job.
 */
export interface SectionErrorReporter {
  (error: Error, info: { sectionId: string; type: string }): void
}

let reporter: SectionErrorReporter | null = null

export function setSectionErrorReporter(fn: SectionErrorReporter | null): void {
  reporter = fn
}

export function reportSectionError(error: Error, info: { sectionId: string; type: string }): void {
  try {
    reporter?.(error, info)
  } catch {
    // A failing reporter must not escalate a hidden section into a broken page.
  }
}
