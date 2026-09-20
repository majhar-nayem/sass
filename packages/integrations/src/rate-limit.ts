import Redis from 'ioredis'

/**
 * A sliding-window limiter shared across app instances.
 *
 * Redis rather than in-process: the renderer runs on several machines, and a per-process
 * counter lets an attacker get N times the allowance simply by being load-balanced. Falls
 * back to in-process when Redis is absent, which is still better than nothing and is what
 * runs in tests.
 */
let redis: Redis | null = null
let tried = false

function client(): Redis | null {
  if (tried) return redis
  tried = true
  const url = process.env.REDIS_URL
  if (!url) return null
  redis = new Redis(url, { maxRetriesPerRequest: 2 })
  redis.on('error', () => {})
  return redis
}

const local = new Map<string, number[]>()

export interface RateLimit {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimit> {
  const now = Date.now()
  const r = client()

  if (r) {
    try {
      const k = `rl:${key}`
      const count = await r.incr(k)
      if (count === 1) await r.expire(k, windowSeconds)
      const ttl = count > limit ? await r.ttl(k) : 0
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: Math.max(ttl, 0) }
    } catch {
      // fall through to the in-process window
    }
  }

  const hits = (local.get(key) ?? []).filter((t) => now - t < windowSeconds * 1000)
  hits.push(now)
  local.set(key, hits)
  return {
    allowed: hits.length <= limit,
    remaining: Math.max(0, limit - hits.length),
    retryAfterSeconds: hits.length > limit ? windowSeconds : 0,
  }
}

export function __resetRateLimit(): void {
  local.clear()
}

/** IPs are hashed before they are stored anywhere — APP 3, data minimisation. */
export async function hashIp(ip: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256')
    .update(`${ip}:${process.env.BETTER_AUTH_SECRET ?? 'salt'}`)
    .digest('hex')
    .slice(0, 32)
}
