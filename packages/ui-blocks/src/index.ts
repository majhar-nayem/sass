/**
 * The rendered component catalogue (C-01…C-04, week 3).
 *
 * This package receives props and a theme. It knows nothing about tenants, auth or the
 * database — the lint boundary in eslint.config.js enforces that, because the renderer's
 * speed and the components' testability both depend on it.
 */
export type { SectionSpec, ThemeSpec, WebsiteSpec } from '@awning/spec'
