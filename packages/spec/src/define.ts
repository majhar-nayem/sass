import { z } from 'zod'
import type { Industry } from './primitives.js'

export type IndustryName = z.infer<typeof Industry>

export interface ComponentDef<
  TType extends string = string,
  TProps extends z.ZodTypeAny = z.ZodTypeAny,
> {
  type: TType
  variants: readonly [string, ...string[]]
  props: TProps
  /** Prose handed to the model in the cached catalogue. Written for a model, not a human. */
  aiGuidance: string
  industryDefaults?: Partial<Record<IndustryName, { variant?: string; props?: object }>>
}

/**
 * A component is defined exactly once, here. The Zod schema, the JSON Schema handed to
 * the model, the renderer's prop types and the AI catalogue are all generated from this
 * object. If they are ever maintained separately they drift, and the failure is silent
 * and visual: the model proposes props the renderer cannot render.
 */
export function defineComponent<TType extends string, TProps extends z.ZodTypeAny>(
  def: ComponentDef<TType, TProps>,
): ComponentDef<TType, TProps> {
  return def
}

/** Wraps a component definition into the section envelope the renderer walks. */
export function sectionSchema<TType extends string, TProps extends z.ZodTypeAny>(
  def: ComponentDef<TType, TProps>,
) {
  // Reject unknown props rather than stripping them. Zod's default is to strip, which
  // is safe but silent — and silence hides a model that has misunderstood the catalogue.
  const props = def.props instanceof z.ZodObject ? def.props.strict() : def.props
  return z.object({
    id: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
    type: z.literal(def.type),
    variant: z.enum(def.variants),
    hidden: z.boolean().default(false),
    background: z.enum(['default', 'surface', 'primary', 'accent', 'dark', 'image']).default('default'),
    spacing: z.enum(['none', 'sm', 'md', 'lg', 'xl']).default('lg'),
    anchor: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
    props,
  }).strict()
}
