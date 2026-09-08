'use client'
import { Component, type ReactNode } from 'react'

/**
 * C-03 -- one error boundary per section.
 *
 * Content here is machine-generated, so a component will eventually meet props it
 * cannot handle. When that happens the section hides itself and the rest of the
 * customer's live website keeps working. A white screen on a tradie's site because
 * one testimonial had a null author is not an acceptable failure mode.
 */
export class SectionBoundary extends Component<
  { sectionId: string; type: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error) {
    // Sentry lands here in F-11, tagged with sectionId and type.
    console.error(`[section ${this.props.type}#${this.props.sectionId}]`, error.message)
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
