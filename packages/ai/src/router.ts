import type { AiActionType } from './models.js'

/**
 * A-09 -- intent routing.
 *
 * Decides which model handles a turn, and whether a model is needed at all. The cheapest
 * call is the one never made: a third of edit turns are a typo fix or a colour change
 * that the editor UI can apply directly.
 *
 * The classifier is rules-first on purpose. Spending a model call to decide whether to
 * spend a model call only pays off when the rules are genuinely ambiguous, and for this
 * vocabulary they usually are not.
 */
export type Intent =
  | { kind: 'edit'; action: AiActionType; confidence: 'high' | 'low' }
  | { kind: 'rewrite'; action: 'rewrite'; confidence: 'high' | 'low' }
  | { kind: 'question'; action: 'support'; confidence: 'high' | 'low' }
  | { kind: 'undo' }

const UNDO = /^(undo|revert|go back|undo that|change it back|put it back)\b/i

/** Wording that means "rewrite the words", where quality is visible and Opus earns it. */
const REWRITE = [
  /\b(rewrite|reword|rephrase|better words|copy|wording|tone|sounds? (too|a bit))\b/i,
  /\bmake (it|the .+) (sound|read) \w+/i,
  /\bwrite (me|us|a|the)\b/i,
  /\b(more|less) (formal|casual|friendly|professional|punchy|warm)\b/i,
]

const QUESTION = [
  /^(how|what|why|when|where|can i|can you|do i|does it|is it|will it)\b/i,
  /\?\s*$/,
]

/** A question that is really an instruction: "can you make the hero smaller?" */
const IMPERATIVE_INSIDE_QUESTION =
  /\b(make|change|add|remove|delete|move|hide|show|set|update|put|swap|replace)\b/i

export function classifyIntent(message: string): Intent {
  const m = message.trim()
  if (UNDO.test(m)) return { kind: 'undo' }

  if (REWRITE.some((re) => re.test(m))) return { kind: 'rewrite', action: 'rewrite', confidence: 'high' }

  if (QUESTION.some((re) => re.test(m)) && !IMPERATIVE_INSIDE_QUESTION.test(m))
    return { kind: 'question', action: 'support', confidence: 'high' }

  const looksLikeEdit = IMPERATIVE_INSIDE_QUESTION.test(m)
  return { kind: 'edit', action: 'edit', confidence: looksLikeEdit ? 'high' : 'low' }
}

/**
 * Turns that the editor can satisfy without any model call, when the UI has already told
 * us exactly what changed. These come from clicking a heading and retyping it, using the
 * colour picker, dragging a section, or toggling one off — not from parsing English.
 *
 * Parsing "make the hero smaller" with a regex would be the tempting version of this and
 * the wrong one: the moment the rules are approximate they are wrong in ways nobody can
 * predict, on a customer's live site.
 */
export type FastPathOp =
  | { op: 'set_text'; sectionId: string; path: string; value: string }
  | { op: 'set_theme_colour'; key: 'primary' | 'secondary' | 'accent' | 'neutral' | 'surface'; value: string }
  | { op: 'toggle_section'; sectionId: string; hidden: boolean }
  | { op: 'reorder_sections'; pageId: string; sectionIds: string[] }
  | { op: 'replace_image'; sectionId: string; path: string; assetId: string; alt?: string }

export const FAST_PATH_OPS = [
  'set_text',
  'set_theme_colour',
  'toggle_section',
  'reorder_sections',
  'replace_image',
] as const
