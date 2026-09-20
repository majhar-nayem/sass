import Anthropic from '@anthropic-ai/sdk'
import { withoutOrgContext } from '@awning/db'
import { MODELS, MAX_TOKENS, ROUTING, costCentsAud, type AiActionType, type ModelKey, type TokenUsage } from './models.js'
import { AiDenied, checkQuota } from './quota.js'

let client: Anthropic | null = null
export function anthropic(): Anthropic {
  // Zero-arg constructor on purpose: the SDK resolves ANTHROPIC_API_KEY, then
  // ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile. Reading the env var
  // ourselves would break the profile path.
  client ??= new Anthropic({ maxRetries: 0 }) // we own retries; see below
  return client
}

export function __setClient(c: Anthropic | null): void {
  client = c
}

export interface AiRequest {
  orgId: string
  siteId?: string | undefined
  userId?: string | undefined
  action: AiActionType
  /** Stable, cached prefix. Must not contain timestamps or per-request ids. */
  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools?: Anthropic.Tool[] | undefined
  outputSchema?: Record<string, unknown> | undefined
  model?: ModelKey | undefined
  maxTokens?: number | undefined
  /** Retries caused by OUR bug do not consume the customer's quota. */
  countsToQuota?: boolean
}

export interface AiResult {
  message: Anthropic.Message
  usage: TokenUsage
  costCentsAud: number
  latencyMs: number
  model: ModelKey
  cacheHitRatio: number
}

/**
 * Contract #5 -- every model call in the product goes through here.
 *
 * Three things it guarantees that a bare SDK call does not:
 *
 *  1. Quota, spend cap, rate limit and the platform circuit breaker are checked first.
 *  2. Usage is written to ai_usage even when the call fails. The row is inserted BEFORE
 *     the await and updated after, because a request that times out or throws has still
 *     cost money — metering only on success systematically under-reports spend, and the
 *     under-report is worst exactly when something is going wrong.
 *  3. Retries are ours, not the SDK's, so an attempt that is retried is attributable and
 *     a rate-limit retry does not silently multiply a customer's quota usage.
 */
export async function runAiAction(req: AiRequest): Promise<AiResult> {
  const decision = await checkQuota(req.orgId)
  if (!decision.allowed) throw new AiDenied(decision.reason!, decision.message!)

  const modelKey = req.model ?? ROUTING[req.action]
  const spec = MODELS[modelKey]
  const maxTokens = req.maxTokens ?? MAX_TOKENS[req.action]
  const startedAt = Date.now()

  const usageId = await withoutOrgContext('cron', async (db) => {
    const row = await db.ai_usage.create({
      data: {
        org_id: req.orgId,
        site_id: req.siteId ?? null,
        user_id: req.userId ?? null,
        action_type: req.action,
        model: spec.id,
        success: false, // flipped on completion; a crash leaves it false, which is true
        counts_to_quota: req.countsToQuota ?? true,
      },
      select: { id: true },
    })
    return row.id
  })

  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: spec.id,
    max_tokens: maxTokens,
    system: req.system,
    messages: req.messages,
    ...(req.tools ? { tools: req.tools } : {}),
    ...(spec.thinking === 'adaptive' ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(req.outputSchema
      ? { output_config: { format: { type: 'json_schema' as const, schema: req.outputSchema } } }
      : {}),
  } as Anthropic.MessageCreateParamsNonStreaming

  let message: Anthropic.Message | null = null
  let lastError: unknown = null
  let attempts = 0

  // Two retries, and only for failures that retrying can fix. A 400 is our bug and
  // retrying it just spends money twice.
  for (attempts = 1; attempts <= 3; attempts++) {
    try {
      message =
        maxTokens > 8000
          ? await anthropic().messages.stream(body).finalMessage()
          : await anthropic().messages.create(body)
      break
    } catch (e) {
      lastError = e
      const retryable =
        e instanceof Anthropic.RateLimitError ||
        e instanceof Anthropic.APIConnectionError ||
        (e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 500)
      if (!retryable || attempts === 3) break
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempts - 1)))
    }
  }

  const latencyMs = Date.now() - startedAt

  if (!message) {
    await withoutOrgContext('cron', (db) =>
      db.ai_usage.update({
        where: { id: usageId },
        data: {
          success: false,
          latency_ms: latencyMs,
          retry_count: attempts - 1,
          error_code: errorCode(lastError),
          // A failure that never reached the model cost nothing and must not burn quota.
          counts_to_quota: false,
        },
      }),
    )
    throw lastError
  }

  const usage: TokenUsage = {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  }
  const cost = costCentsAud(modelKey, usage)
  const cacheable = usage.inputTokens + usage.cacheReadTokens
  const cacheHitRatio = cacheable > 0 ? usage.cacheReadTokens / cacheable : 0

  await withoutOrgContext('cron', (db) =>
    db.ai_usage.update({
      where: { id: usageId },
      data: {
        success: true,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
        cache_write_tokens: usage.cacheWriteTokens,
        cost_cents_aud: cost,
        latency_ms: latencyMs,
        retry_count: attempts - 1,
      },
    }),
  )

  return { message, usage, costCentsAud: cost, latencyMs, model: modelKey, cacheHitRatio }
}

function errorCode(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'rate_limit'
  if (e instanceof Anthropic.AuthenticationError) return 'auth'
  if (e instanceof Anthropic.BadRequestError) return 'bad_request'
  if (e instanceof Anthropic.APIConnectionError) return 'connection'
  if (e instanceof Anthropic.APIError) return `http_${e.status ?? 'unknown'}`
  return 'unknown'
}
