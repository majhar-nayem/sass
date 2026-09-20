/**
 * A ~40-line typed client for our own tRPC endpoint.
 *
 * @trpc/client + react-query would give inference and caching, and cost ~40 KB on a
 * dashboard whose whole job is a wizard and a chat box. The types below are hand-written
 * per call site instead, which is a fair trade at this size and revisitable when the
 * dashboard grows.
 */
export class TrpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TrpcError'
  }
}

async function call<T>(path: string, input: unknown, method: 'GET' | 'POST'): Promise<T> {
  const url =
    method === 'GET'
      ? `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `/api/trpc/${path}`

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
  })

  const body = (await res.json()) as {
    result?: { data?: { json: T } }
    error?: { json?: { message?: string; data?: { code?: string } } }
  }

  if (body.error) {
    const e = body.error.json
    // The server writes these for the owner ("You've used your 400 AI changes...").
    // Replacing them with "Request failed" throws away the only useful part.
    throw new TrpcError(e?.data?.code ?? 'UNKNOWN', e?.message ?? 'Something went wrong.')
  }
  return body.result!.data!.json
}

export const trpc = {
  query: <T>(path: string, input?: unknown) => call<T>(path, input, 'GET'),
  mutate: <T>(path: string, input?: unknown) => call<T>(path, input, 'POST'),
}
