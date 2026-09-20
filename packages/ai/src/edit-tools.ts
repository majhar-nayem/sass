import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import {
  COMPONENTS,
  Section,
  Theme,
  addSection,
  createPage,
  deletePage,
  findSection,
  removeSection,
  reorderSections,
  setGlobal,
  setNav,
  setTheme,
  toggleSection,
  uniqueSectionId,
  updatePageSeo,
  updateSection,
  validateSpec,
  type WebsiteSpec,
} from '@awning/spec'

/**
 * A-08 -- the edit tool set.
 *
 * The brief called for "patches/deltas", which is the right instinct. JSON Patch is the
 * wrong implementation: a model emits a plausible-looking pointer like
 * `/pages/0/sections/3/props/heading`, gets the index wrong, and silently rewrites a
 * different section. Nothing errors and there is no way to check intent after the fact.
 *
 * Addressing by sectionId makes that failure impossible. Each call is also validated on
 * its own before it is applied, so one bad call is rejected with a reason instead of
 * poisoning the whole turn — and the list of applied calls reads as an audit trail in
 * plain English rather than as a diff.
 */

const SECTION_TYPES = COMPONENTS.map((c) => c.type) as [string, ...string[]]

export const EDIT_TOOL_SCHEMAS = {
  set_theme: z.object({ patch: Theme.partial() }),
  add_section: z.object({
    pageId: z.string(),
    type: z.enum(SECTION_TYPES),
    variant: z.string(),
    props: z.record(z.unknown()),
    position: z.number().int().min(0).optional(),
    background: z.enum(['default', 'surface', 'primary', 'accent', 'dark', 'image']).optional(),
    anchor: z.string().optional(),
  }),
  update_section: z.object({
    sectionId: z.string(),
    props: z.record(z.unknown()).optional(),
    variant: z.string().optional(),
    background: z.enum(['default', 'surface', 'primary', 'accent', 'dark', 'image']).optional(),
    spacing: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
  }),
  remove_section: z.object({ sectionId: z.string() }),
  reorder_sections: z.object({ pageId: z.string(), sectionIds: z.array(z.string()).min(1) }),
  toggle_section: z.object({ sectionId: z.string(), hidden: z.boolean() }),
  create_page: z.object({ path: z.string(), title: z.string(), sections: z.array(z.unknown()) }),
  delete_page: z.object({ pageId: z.string() }),
  update_page_seo: z.object({
    pageId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    noindex: z.boolean().optional(),
  }),
  set_nav: z.object({ items: z.array(z.object({ label: z.string(), href: z.string() })), cta: z.unknown().optional() }),
  set_global: z.object({
    key: z.enum(['announcementBar', 'whatsappBubble', 'stickyCallBar']),
    value: z.unknown(),
  }),
  ask_user: z.object({ question: z.string(), options: z.array(z.string()).max(6).optional() }),
  explain: z.object({ message: z.string() }),
} as const

export type EditToolName = keyof typeof EDIT_TOOL_SCHEMAS

export interface EditToolCall {
  name: EditToolName
  input: Record<string, unknown>
}

export interface AppliedCall {
  call: EditToolCall
  /** Written for the owner: "Changed the colours to dark green and gold." */
  summary: string
}

export interface RejectedCall {
  call: EditToolCall
  reason: string
}

export interface ApplyResult {
  spec: WebsiteSpec
  applied: AppliedCall[]
  rejected: RejectedCall[]
  /** Set when the model asked a question instead of editing. */
  question?: { question: string; options?: string[] }
  /** Set when the model declined or explained rather than editing. */
  explanation?: string
}

/** The variants each component actually has, so an invented one is caught per call. */
const VARIANTS = new Map(COMPONENTS.map((c) => [c.type as string, c.variants as readonly string[]]))

function describeTheme(patch: Record<string, unknown>): string {
  const keys = Object.keys(patch)
  if (keys.some((k) => ['primary', 'accent', 'secondary', 'neutral'].includes(k)))
    return 'Updated the colours'
  if (keys.some((k) => k.endsWith('Font'))) return 'Changed the fonts'
  return 'Adjusted the styling'
}

/**
 * Applies tool calls in order, each onto the result of the last.
 *
 * Partial success is deliberate. If the owner asks for three things and one cannot be
 * done, doing the other two and saying which was skipped is far better than refusing all
 * three — and it is what a person would do.
 */
export function applyEditTools(spec: WebsiteSpec, calls: EditToolCall[]): ApplyResult {
  let current = spec
  const applied: AppliedCall[] = []
  const rejected: RejectedCall[] = []
  let question: ApplyResult['question']
  let explanation: string | undefined

  for (const call of calls) {
    const schema = EDIT_TOOL_SCHEMAS[call.name]
    if (!schema) {
      rejected.push({ call, reason: `No such tool: ${call.name}` })
      continue
    }
    const parsed = schema.safeParse(call.input)
    if (!parsed.success) {
      rejected.push({ call, reason: parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') })
      continue
    }

    try {
      const input = parsed.data as Record<string, unknown>
      switch (call.name) {
        case 'set_theme': {
          const patch = (input.patch ?? {}) as Record<string, unknown>
          current = setTheme(current, patch)
          applied.push({ call, summary: describeTheme(patch) })
          break
        }
        case 'add_section': {
          const { pageId, type, variant, props, position, background, anchor } = input as unknown as {
            pageId: string; type: string; variant: string; props: Record<string, unknown>
            position?: number; background?: string; anchor?: string
          }
          const allowed = VARIANTS.get(type)
          if (!allowed?.includes(variant))
            throw new Error(`"${variant}" is not a variant of ${type}. Options: ${allowed?.join(', ')}`)

          const section = {
            id: uniqueSectionId(current, type),
            type, variant, hidden: false,
            background: background ?? 'default',
            spacing: 'lg',
            ...(anchor ? { anchor } : {}),
            props,
          }
          // Validate the section alone before it touches the document, so the error
          // names the section rather than appearing as a mystery further down.
          const check = Section.safeParse(section)
          if (!check.success)
            throw new Error(check.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; '))

          current = addSection(current, pageId, check.data, position)
          applied.push({ call, summary: `Added a ${type} section` })
          break
        }
        case 'update_section': {
          const { sectionId, props, variant, background, spacing } = input as unknown as {
            sectionId: string; props?: Record<string, unknown>; variant?: string
            background?: string; spacing?: string
          }
          const found = findSection(current, sectionId)
          if (!found) throw new Error(`No section called "${sectionId}".`)
          if (variant !== undefined) {
            const allowed = VARIANTS.get(found.section.type)
            if (!allowed?.includes(variant))
              throw new Error(`"${variant}" is not a variant of ${found.section.type}.`)
          }
          current = updateSection(current, sectionId, { props, variant, background, spacing })
          applied.push({ call, summary: `Updated the ${found.section.type} section` })
          break
        }
        case 'remove_section': {
          const { sectionId } = input as unknown as { sectionId: string }
          const found = findSection(current, sectionId)
          if (!found) throw new Error(`No section called "${sectionId}".`)
          current = removeSection(current, sectionId)
          applied.push({ call, summary: `Removed the ${found.section.type} section` })
          break
        }
        case 'reorder_sections': {
          const { pageId, sectionIds } = input as unknown as { pageId: string; sectionIds: string[] }
          current = reorderSections(current, pageId, sectionIds)
          applied.push({ call, summary: 'Reordered the sections' })
          break
        }
        case 'toggle_section': {
          const { sectionId, hidden } = input as unknown as { sectionId: string; hidden: boolean }
          const found = findSection(current, sectionId)
          if (!found) throw new Error(`No section called "${sectionId}".`)
          current = toggleSection(current, sectionId, hidden)
          applied.push({ call, summary: `${hidden ? 'Hid' : 'Showed'} the ${found.section.type} section` })
          break
        }
        case 'create_page': {
          const { path, title, sections } = input as unknown as { path: string; title: string; sections: unknown[] }
          const page = {
            id: path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'home',
            path, title,
            sections: sections.map((s) => Section.parse(s)),
          }
          current = createPage(current, page)
          applied.push({ call, summary: `Created the ${title} page` })
          break
        }
        case 'delete_page': {
          const { pageId } = input as unknown as { pageId: string }
          current = deletePage(current, pageId)
          applied.push({ call, summary: 'Deleted a page' })
          break
        }
        case 'update_page_seo': {
          const { pageId, ...seo } = input as unknown as { pageId: string; title?: string; description?: string; noindex?: boolean }
          current = updatePageSeo(current, pageId, seo)
          applied.push({ call, summary: 'Updated the page’s search listing' })
          break
        }
        case 'set_nav': {
          current = setNav(current, input as unknown as NonNullable<WebsiteSpec['nav']>)
          applied.push({ call, summary: 'Updated the menu' })
          break
        }
        case 'set_global': {
          const { key, value } = input as unknown as { key: 'announcementBar' | 'whatsappBubble' | 'stickyCallBar'; value: unknown }
          current = setGlobal(current, key, value)
          const label = { announcementBar: 'the announcement bar', whatsappBubble: 'the WhatsApp button', stickyCallBar: 'the call bar' }[key]
          applied.push({ call, summary: value === null ? `Removed ${label}` : `Updated ${label}` })
          break
        }
        case 'ask_user': {
          const { question: q, options } = input as unknown as { question: string; options?: string[] }
          question = { question: q, ...(options ? { options } : {}) }
          break
        }
        case 'explain': {
          explanation = (input as unknown as { message: string }).message
          break
        }
      }
    } catch (e) {
      rejected.push({ call, reason: (e as Error).message })
    }
  }

  return { spec: current, applied, rejected, question, explanation }
}

/**
 * Applies the calls, then validates the whole document.
 *
 * Per-call validation catches a malformed call; this catches the edits that are each
 * individually fine but wrong together — a nav link to a section that was just removed,
 * a palette that stopped being legible, a countdown whose date has passed.
 */
export function applyAndValidate(
  spec: WebsiteSpec,
  calls: EditToolCall[],
  ctx: Parameters<typeof validateSpec>[1] = {},
): { ok: true; result: ApplyResult } | { ok: false; result: ApplyResult; errors: ReturnType<typeof validateSpec> extends { errors: infer E } ? E : never } {
  const result = applyEditTools(spec, calls)
  if (result.applied.length === 0) return { ok: true, result }

  const check = validateSpec(result.spec, ctx)
  if (check.ok) return { ok: true, result: { ...result, spec: check.spec } }
  return { ok: false, result, errors: check.errors as never }
}

/** Anthropic tool definitions, generated from the same Zod schemas. */
export function editToolDefinitions(): Anthropic.Tool[] {
  const DESCRIPTIONS: Record<EditToolName, string> = {
    set_theme: 'Change colours, fonts, corner radius, density or shadow. Use this for "make it more premium", "change the colours" — not for rewriting copy.',
    add_section: 'Add a new section to a page. Pick a type and variant from the catalogue.',
    update_section: 'Change the content or look of one existing section. Give only the props that change; the rest are preserved.',
    remove_section: 'Delete a section.',
    reorder_sections: 'Change the order of sections on a page.',
    toggle_section: 'Hide or show a section without deleting it.',
    create_page: 'Add a new page, e.g. /christmas.',
    delete_page: 'Delete a page. The home page cannot be deleted.',
    update_page_seo: 'Set the title and description that appear in Google results.',
    set_nav: 'Set the navigation menu items.',
    set_global: 'Turn the announcement bar, WhatsApp button or sticky call bar on or off, or change its content.',
    ask_user: 'Ask the owner one short question when a fact you need is missing. Never invent the fact instead.',
    explain: 'Say something to the owner without changing the site — for example when you cannot do what they asked, or are declining to invent a review.',
  }

  return (Object.keys(EDIT_TOOL_SCHEMAS) as EditToolName[]).map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    input_schema: zodToToolSchema(EDIT_TOOL_SCHEMAS[name]),
  }))
}

function zodToToolSchema(schema: z.ZodTypeAny): Anthropic.Tool['input_schema'] {
  // Kept deliberately loose: the authoritative validation is applyEditTools, which
  // parses with the same Zod schema. A tool schema that drifts from it would reject
  // valid calls at the API boundary for reasons we could not see.
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape ?? {}
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, field] of Object.entries(shape)) {
    properties[key] = { type: jsonTypeOf(field) }
    if (!field.isOptional()) required.push(key)
  }
  return { type: 'object', properties, required } as Anthropic.Tool['input_schema']
}

function jsonTypeOf(field: z.ZodTypeAny): string {
  let f: z.ZodTypeAny = field
  while (f instanceof z.ZodOptional || f instanceof z.ZodDefault) f = f._def.innerType
  if (f instanceof z.ZodString || f instanceof z.ZodEnum) return 'string'
  if (f instanceof z.ZodNumber) return 'number'
  if (f instanceof z.ZodBoolean) return 'boolean'
  if (f instanceof z.ZodArray) return 'array'
  return 'object'
}
