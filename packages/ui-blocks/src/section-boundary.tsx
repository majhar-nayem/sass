'use client'
import { Component, type ReactNode } from 'react'
import { reportSectionError } from './report.js'

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
    // A swallowed error is invisible by definition: the visitor sees a slightly shorter
    // page and nobody is told. This is the only way we hear about it.
    reportSectionError(error, { sectionId: this.props.sectionId, type: this.props.type })
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
