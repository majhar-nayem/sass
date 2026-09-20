/**
 * The rendered component catalogue.
 *
 * This package receives props, a theme and the business's own facts. It knows nothing
 * about tenants, auth or the database — the lint boundary in eslint.config.js enforces
 * that, because the renderer's speed and the components' testability both depend on it.
 */
export { SpecRenderer } from './renderer.js'
export { renderSection } from './sections.js'
export { Section, Heading, Button, Image, Grid, Lede } from './primitives.js'
export { SectionBoundary } from './section-boundary.js'
export { Countdown } from './countdown.js'
export { ContactForm } from './contact-form.js'
export { AnnouncementBar, Navbar, Footer, StickyCallBar, WhatsAppBubble } from './globals.js'
export { JsonLd } from './json-ld.js'
export { themeToCss, autoContrast } from './theme.js'
export type { SectionSpec, ThemeSpec, WebsiteSpec, PageSpec, BusinessFacts } from '@awning/spec'
