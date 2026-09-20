import type { PageSpec, SectionSpec, ThemeSpec, WebsiteSpec } from './spec.js'

/**
 * Pure, deterministic operations on a specification.
 *
 * Everything that edits a site — the AI's tool calls and the editor's direct
 * manipulations alike — goes through these. One implementation means "make the hero
 * smaller" typed into chat and dragging the hero's size control produce byte-identical
 * results, and it means the tricky parts (finding a section by id across pages,
 * preserving order, never mutating the input) are written once.
 *
 * Every function returns a new object. The caller validates the result before it is
 * persisted; nothing here is trusted to produce a valid spec on its own.
 */

function clone<T>(v: T): T {
  return structuredClone(v)
}

export class SectionNotFound extends Error {
  constructor(id: string) {
    super(`No section with id "${id}".`)
    this.name = 'SectionNotFound'
  }
}
export class PageNotFound extends Error {
  constructor(id: string) {
    super(`No page with id "${id}".`)
    this.name = 'PageNotFound'
  }
}

export function findSection(
  spec: WebsiteSpec,
  sectionId: string,
): { page: PageSpec; section: SectionSpec; index: number } | null {
  for (const page of spec.pages) {
    const index = page.sections.findIndex((s) => s.id === sectionId)
    if (index !== -1) return { page, section: page.sections[index]!, index }
  }
  return null
}

/** Stable, readable ids. Collisions get a numeric suffix rather than a random one. */
export function uniqueSectionId(spec: WebsiteSpec, type: string): string {
  const taken = new Set(spec.pages.flatMap((p) => p.sections.map((s) => s.id)))
  const base = type.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  if (!taken.has(base)) return base
  for (let n = 2; n < 200; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  return `${base}-${Date.now().toString(36)}`
}

/* ------------------------------------------------------------------- theme --- */

export function setTheme(spec: WebsiteSpec, patch: Partial<ThemeSpec>): WebsiteSpec {
  const next = clone(spec)
  next.theme = { ...next.theme, ...patch }
  return next
}

/* ---------------------------------------------------------------- sections --- */

/**
 * Deep-merges props. A shallow assign would drop sibling keys: "change the heading"
 * would silently delete the subheading, the CTA and the trust points.
 */
function mergeProps(current: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return clone(patch) // arrays are replaced wholesale
  if (patch && typeof patch === 'object' && current && typeof current === 'object' && !Array.isArray(current)) {
    const out: Record<string, unknown> = { ...(current as Record<string, unknown>) }
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      if (v === null) delete out[k]
      else out[k] = mergeProps(out[k], v)
    }
    return out
  }
  return clone(patch)
}

export function updateSection(
  spec: WebsiteSpec,
  sectionId: string,
  patch: { props?: Record<string, unknown>; variant?: string; background?: string; spacing?: string; anchor?: string },
): WebsiteSpec {
  const found = findSection(spec, sectionId)
  if (!found) throw new SectionNotFound(sectionId)

  const next = clone(spec)
  const page = next.pages.find((p) => p.id === found.page.id)!
  const section = page.sections[found.index]! as unknown as Record<string, unknown>

  if (patch.props) section.props = mergeProps(section.props, patch.props)
  if (patch.variant !== undefined) section.variant = patch.variant
  if (patch.background !== undefined) section.background = patch.background
  if (patch.spacing !== undefined) section.spacing = patch.spacing
  if (patch.anchor !== undefined) section.anchor = patch.anchor
  return next
}

export function addSection(
  spec: WebsiteSpec,
  pageId: string,
  section: SectionSpec,
  position?: number,
): WebsiteSpec {
  const next = clone(spec)
  const page = next.pages.find((p) => p.id === pageId)
  if (!page) throw new PageNotFound(pageId)

  const at = position === undefined ? page.sections.length : Math.max(0, Math.min(position, page.sections.length))
  page.sections.splice(at, 0, clone(section))
  return next
}

export function removeSection(spec: WebsiteSpec, sectionId: string): WebsiteSpec {
  const found = findSection(spec, sectionId)
  if (!found) throw new SectionNotFound(sectionId)

  const next = clone(spec)
  const page = next.pages.find((p) => p.id === found.page.id)!
  page.sections.splice(found.index, 1)
  return next
}

export function toggleSection(spec: WebsiteSpec, sectionId: string, hidden: boolean): WebsiteSpec {
  const found = findSection(spec, sectionId)
  if (!found) throw new SectionNotFound(sectionId)

  const next = clone(spec)
  const page = next.pages.find((p) => p.id === found.page.id)!
  page.sections[found.index]!.hidden = hidden
  return next
}

/**
 * Reorders by id. Any section the caller omits keeps its position at the end, so a
 * partial list cannot silently delete sections — the failure mode of the obvious
 * implementation, and an unrecoverable one on a live site.
 */
export function reorderSections(spec: WebsiteSpec, pageId: string, sectionIds: string[]): WebsiteSpec {
  const next = clone(spec)
  const page = next.pages.find((p) => p.id === pageId)
  if (!page) throw new PageNotFound(pageId)

  const byId = new Map(page.sections.map((s) => [s.id, s]))
  const ordered: SectionSpec[] = []
  for (const id of sectionIds) {
    const s = byId.get(id)
    if (!s) throw new SectionNotFound(id)
    ordered.push(s)
    byId.delete(id)
  }
  page.sections = [...ordered, ...byId.values()]
  return next
}

/* ------------------------------------------------------------------- pages --- */

export function createPage(spec: WebsiteSpec, page: PageSpec): WebsiteSpec {
  const next = clone(spec)
  if (next.pages.some((p) => p.path === page.path))
    throw new Error(`A page already exists at ${page.path}.`)
  next.pages.push(clone(page))
  return next
}

export function deletePage(spec: WebsiteSpec, pageId: string): WebsiteSpec {
  const next = clone(spec)
  const i = next.pages.findIndex((p) => p.id === pageId)
  if (i === -1) throw new PageNotFound(pageId)
  if (next.pages[i]!.path === '/') throw new Error('The home page cannot be deleted.')
  next.pages.splice(i, 1)
  return next
}

export function updatePageSeo(
  spec: WebsiteSpec,
  pageId: string,
  seo: { title?: string; description?: string; noindex?: boolean },
): WebsiteSpec {
  const next = clone(spec)
  const page = next.pages.find((p) => p.id === pageId)
  if (!page) throw new PageNotFound(pageId)
  page.seo = { ...(page.seo ?? { noindex: false }), ...seo }
  return next
}

/* ----------------------------------------------------------------- globals --- */

export function setNav(spec: WebsiteSpec, nav: NonNullable<WebsiteSpec['nav']>): WebsiteSpec {
  const next = clone(spec)
  next.nav = clone(nav)
  return next
}

export function setGlobal(
  spec: WebsiteSpec,
  key: 'announcementBar' | 'whatsappBubble' | 'stickyCallBar',
  value: unknown,
): WebsiteSpec {
  const next = clone(spec)
  next.globals = { ...(next.globals ?? {}) }
  if (value === null) delete (next.globals as Record<string, unknown>)[key]
  else (next.globals as Record<string, unknown>)[key] = clone(value)
  return next
}

/* --------------------------------------------------- A-11: the fast path ----- */

/**
 * Sets one text field by path, e.g. `hero-main.heading` or `services-1.items.0.title`.
 *
 * This is what the editor calls when someone clicks a heading in the preview and retypes
 * it. Roughly a third of all edits are this shape, and routing them through a model
 * would be slower, more expensive and less reliable than a direct write — the model can
 * only ever reproduce what the user already typed.
 */
export function setTextAtPath(spec: WebsiteSpec, sectionId: string, path: string, value: string): WebsiteSpec {
  const found = findSection(spec, sectionId)
  if (!found) throw new SectionNotFound(sectionId)

  const next = clone(spec)
  const page = next.pages.find((p) => p.id === found.page.id)!
  const section = page.sections[found.index]! as unknown as { props: Record<string, unknown> }

  const parts = path.split('.')
  let cursor: Record<string, unknown> | unknown[] = section.props
  for (const part of parts.slice(0, -1)) {
    const key = Array.isArray(cursor) ? Number(part) : part
    const child = (cursor as Record<string | number, unknown>)[key]
    if (child == null || typeof child !== 'object')
      throw new Error(`"${path}" does not exist on section ${sectionId}.`)
    cursor = child as Record<string, unknown> | unknown[]
  }

  const last = parts.at(-1)!
  const key = Array.isArray(cursor) ? Number(last) : last
  if (!(key in (cursor as object))) throw new Error(`"${path}" does not exist on section ${sectionId}.`)
  if (typeof (cursor as Record<string | number, unknown>)[key] !== 'string')
    throw new Error(`"${path}" is not a text field.`)
  ;(cursor as Record<string | number, unknown>)[key] = value
  return next
}

/** Swaps an image asset, keeping the alt text unless a new one is given. */
export function replaceImage(
  spec: WebsiteSpec,
  sectionId: string,
  path: string,
  assetId: string,
  alt?: string,
): WebsiteSpec {
  const found = findSection(spec, sectionId)
  if (!found) throw new SectionNotFound(sectionId)

  const next = clone(spec)
  const page = next.pages.find((p) => p.id === found.page.id)!
  const section = page.sections[found.index]! as unknown as { props: Record<string, unknown> }

  const parts = path.split('.')
  let cursor: Record<string, unknown> = section.props
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part]
    if (child == null || typeof child !== 'object') throw new Error(`"${path}" does not exist.`)
    cursor = child as Record<string, unknown>
  }
  const last = parts.at(-1)!
  const current = (cursor[last] ?? {}) as { alt?: string; focal?: string }
  cursor[last] = { assetId, alt: alt ?? current.alt ?? '', focal: current.focal ?? 'center' }
  return next
}
