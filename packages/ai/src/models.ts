/**
 * Model registry, pricing and routing.
 *
 * Prices are USD per million tokens, from the Anthropic pricing table. AUD figures
 * everywhere else in this package are derived, never hardcoded, so a rate change is one
 * constant.
 */
export const AUD_PER_USD = 1.55

export interface ModelSpec {
  id: string
  /** USD per million input tokens. */
  input: number
  /** USD per million output tokens. */
  output: number
  /** Cache reads are ~10% of base input; cache writes ~125%. */
  cacheReadMultiplier: number
  cacheWriteMultiplier: number
  contextWindow: number
  /** Opus 5 and Sonnet 5 reject budget_tokens; Haiku 4.5 still takes it. */
  thinking: 'adaptive' | 'budget' | 'none'
}

export const MODELS = {
  opus: {
    id: 'claude-opus-5',
    input: 5.0,
    output: 25.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    contextWindow: 1_000_000,
    thinking: 'adaptive',
  },
  sonnet: {
    id: 'claude-sonnet-5',
    input: 2.0,
    output: 10.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    contextWindow: 1_000_000,
    thinking: 'adaptive',
  },
  haiku: {
    id: 'claude-haiku-4-5',
    input: 1.0,
    output: 5.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    contextWindow: 200_000,
    thinking: 'budget',
  },
} as const satisfies Record<string, ModelSpec>

export type ModelKey = keyof typeof MODELS

export type AiActionType =
  | 'generate'
  | 'edit'
  | 'rewrite'
  | 'seo'
  | 'christmas'
  | 'image_prompt'
  | 'support'

/**
 * Which model handles which action.
 *
 * Generation runs on Opus because the design judgement and the copy *are* the product —
 * it is the one moment a customer decides whether this was worth paying for. At roughly
 * A$0.31 a generation against A$49/month revenue, choosing a cheaper model here would
 * save about twenty cents a customer and risk the only thing they judge us on.
 *
 * Mechanical edits run on Haiku. "Make the hero smaller" is a tool call with one
 * argument; there is no judgement to buy. Copy rewrites go back to Opus because the
 * owner reads the result.
 */
export const ROUTING: Record<AiActionType, ModelKey> = {
  generate: 'opus',
  edit: 'haiku',
  rewrite: 'opus',
  seo: 'haiku',
  christmas: 'haiku',
  image_prompt: 'haiku',
  support: 'haiku',
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Cost of one call in AUD cents, at four decimal places to survive summation. */
export function costCentsAud(model: ModelKey, u: TokenUsage): number {
  const m = MODELS[model]
  const usd =
    (u.inputTokens * m.input +
      u.outputTokens * m.output +
      u.cacheReadTokens * m.input * m.cacheReadMultiplier +
      u.cacheWriteTokens * m.input * m.cacheWriteMultiplier) /
    1_000_000
  return Math.round(usd * AUD_PER_USD * 100 * 10_000) / 10_000
}

/** Per-action output ceiling. A runaway generation is capped here, not by the bill. */
export const MAX_TOKENS: Record<AiActionType, number> = {
  generate: 16_000,
  edit: 2_000,
  rewrite: 4_000,
  seo: 1_000,
  christmas: 4_000,
  image_prompt: 500,
  support: 2_000,
}
