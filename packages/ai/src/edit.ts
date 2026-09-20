import type Anthropic from '@anthropic-ai/sdk'
import { validateSpec, type SpecError, type ValidationCtx, type WebsiteSpec } from '@awning/spec'
import { runAiAction } from './client.js'
import { buildSystemPrefix } from './prompt.js'
import { buildEditContext } from './digest.js'
import { classifyIntent } from './router.js'
import {
  applyEditTools,
  editToolDefinitions,
  type ApplyResult,
  type EditToolCall,
} from './edit-tools.js'

const EDIT_RULES = `You are editing an existing published website.

## Rules of editing

- Change ONLY what was asked. If they ask to change the colours, do not also rewrite the
  hero heading. Owners notice unrequested changes and stop trusting the tool immediately.
- Prefer the smallest tool call that achieves the request.
- "Make it more premium" is a theme and variant change — deeper palette, serif headings,
  more whitespace, spacious density — NOT a rewrite of all the copy.
- "Make the hero smaller" is props.height on the hero, not a new section.
- If the catalogue cannot do what they asked, say so in one sentence with explain() and
  offer the nearest thing it can do. Never pretend.
- If the request is ambiguous in a way that matters, call ask_user. If it is ambiguous in
  a way that does not, pick the sensible reading and say which one you picked.
- If they ask for something that would breach a hard rule — invented reviews, a fake
  countdown, "say we're the cheapest" — decline that part in one sentence with the real
  reason, do everything else they asked, and say what you skipped.

After the tool calls, write ONE short sentence to the owner describing what changed, in
their language. "Done — the colours are now dark green and gold, and the hero is
shorter." Not "I have updated the theme object's primary token."`

export interface EditOptions {
  orgId: string
  siteId: string
  userId?: string
  spec: WebsiteSpec
  message: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  verifiedFacts?: ValidationCtx['verifiedFacts']
}

export type EditOutcome =
  | { kind: 'changed'; spec: WebsiteSpec; result: ApplyResult; reply: string; costCentsAud: number }
  | { kind: 'no-change'; reply: string; result: ApplyResult; costCentsAud: number }
  | { kind: 'failed'; errors: SpecError[]; reply: string; costCentsAud: number }
  | { kind: 'undo' }

/**
 * A-08/A-09 -- one conversational edit turn.
 *
 * The previous specification is never mutated. If anything about this turn fails —
 * a malformed tool call, a document that stops validating — the caller still holds the
 * spec it passed in, and the customer's live site is untouched.
 */
export async function editSite(o: EditOptions): Promise<EditOutcome> {
  const intent = classifyIntent(o.message)
  if (intent.kind === 'undo') return { kind: 'undo' }

  const system: Anthropic.TextBlockParam[] = [
    ...buildSystemPrefix(o.spec.site.industry),
    { type: 'text', text: EDIT_RULES },
  ]

  const messages: Anthropic.MessageParam[] = [
    ...(o.history ?? []).slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: `${buildEditContext(o.spec, o.message)}\n\n${o.message}` },
  ]

  const res = await runAiAction({
    orgId: o.orgId,
    siteId: o.siteId,
    userId: o.userId,
    action: intent.action,
    system,
    messages,
    tools: editToolDefinitions(),
  })

  const calls: EditToolCall[] = res.message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ name: b.name as EditToolCall['name'], input: b.input as Record<string, unknown> }))

  const reply =
    res.message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim() || 'Done.'

  const result = applyEditTools(o.spec, calls)

  if (result.applied.length === 0)
    return {
      kind: 'no-change',
      reply: result.question?.question ?? result.explanation ?? reply,
      result,
      costCentsAud: res.costCentsAud,
    }

  // Individually valid calls can still produce a document that is wrong as a whole: a
  // nav link to a section that was just removed, a palette that stopped being legible.
  const check = validateSpec(result.spec, { verifiedFacts: o.verifiedFacts })
  if (!check.ok)
    return {
      kind: 'failed',
      errors: check.errors,
      reply: "I couldn't make that change without breaking something on the site. Nothing has changed — could you try describing it a different way?",
      costCentsAud: res.costCentsAud,
    }

  return { kind: 'changed', spec: check.spec, result, reply, costCentsAud: res.costCentsAud }
}

/** The one-sentence summary stored on the version row and shown in history. */
export function summariseChanges(result: ApplyResult): string {
  if (result.applied.length === 0) return 'No changes'
  if (result.applied.length === 1) return result.applied[0]!.summary
  const parts = result.applied.map((a) => a.summary)
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!.toLowerCase()}`
}
