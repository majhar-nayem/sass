/**
 * The rendered component catalogue.
 *
 * This package receives props and a theme. It knows nothing about tenants, auth or the
 * database — the lint boundary in eslint.config.js enforces that, because the renderer's
 * speed and the components' testability both depend on it.
 */
export { SpecRenderer } from './renderer.js'
export { Section, renderSection, IMPLEMENTED_TYPES } from './sections.js'
export { SectionBoundary } from './section-boundary.js'
export { themeToCss, autoContrast } from './theme.js'
export type { SectionSpec, ThemeSpec, WebsiteSpec, PageSpec } from '@awning/spec'
