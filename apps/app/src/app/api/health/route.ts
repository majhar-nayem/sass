export const dynamic = 'force-dynamic'

/** Liveness. Deliberately dependency-free — see packages/api/src/health.ts. */
export function GET() {
  return Response.json({ ok: true, service: 'app', ts: new Date().toISOString() })
}
