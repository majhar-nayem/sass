/**
 * A-06 -- the eval harness.
 *
 *   pnpm --filter @awning/ai eval            # all briefs
 *   pnpm --filter @awning/ai eval -- --only halal-butcher-full
 *   pnpm --filter @awning/ai eval -- --limit 5
 *
 * Every run costs real money, so it prints the bill and refuses to start without a key.
 * CI runs the offline half (packages/ai/src/__tests__) on every commit; this online half
 * runs before a prompt or schema change is merged.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateSite } from '../generate.js'
import { BRIEFS } from './briefs.js'
import { assertSpec, type Finding } from './assertions.js'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : undefined
const orgId = process.env.EVAL_ORG_ID

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('No Anthropic credentials. Set ANTHROPIC_API_KEY, or run `ant auth login`.')
  process.exit(2)
}
if (!orgId) {
  console.error('Set EVAL_ORG_ID to an org with quota — every call is metered like a real one.')
  process.exit(2)
}

const selected = BRIEFS.filter((b) => !only || b.id === only).slice(0, limit ?? undefined)

interface Row {
  id: string
  ok: boolean
  attempts: number
  costCents: number
  ms: number
  findings: Finding[]
}

const rows: Row[] = []
console.log(`Running ${selected.length} briefs...\n`)

for (const eb of selected) {
  const started = Date.now()
  const result = await generateSite({ orgId, brief: eb.brief })
  const ms = Date.now() - started

  if (!result.ok) {
    rows.push({
      id: eb.id,
      ok: false,
      attempts: result.attempts,
      costCents: result.costCentsAud,
      ms,
      findings: result.errors.slice(0, 5).map((e) => ({ rule: 'gate', detail: `${e.path}: ${e.message}` })),
    })
  } else {
    const findings = assertSpec(result.spec, eb)
    rows.push({ id: eb.id, ok: findings.length === 0, attempts: result.attempts, costCents: result.costCentsAud, ms, findings })
    mkdirSync(resolve(import.meta.dirname, '../../.evals'), { recursive: true })
    writeFileSync(
      resolve(import.meta.dirname, `../../.evals/${eb.id}.json`),
      JSON.stringify(result.spec, null, 2),
    )
  }

  const r = rows.at(-1)!
  const mark = r.ok ? 'PASS' : 'FAIL'
  console.log(
    `${mark.padEnd(5)} ${eb.id.padEnd(26)} ${String(r.attempts)}x  A$${(r.costCents / 100).toFixed(3).padStart(6)}  ${String(ms).padStart(6)}ms  ${r.findings.length ? r.findings.length + ' findings' : ''}`,
  )
  for (const f of r.findings.slice(0, 4)) console.log(`        ${f.rule}: ${f.detail}`)
}

const passed = rows.filter((r) => r.ok).length
const cost = rows.reduce((n, r) => n + r.costCents, 0)
const retried = rows.filter((r) => r.attempts > 1).length

console.log('\n' + '-'.repeat(72))
console.log(`  passed          ${passed}/${rows.length}  (${Math.round((100 * passed) / rows.length)}%)`)
console.log(`  needed a retry  ${retried}/${rows.length}`)
console.log(`  total cost      A$${(cost / 100).toFixed(2)}   mean A$${(cost / rows.length / 100).toFixed(3)}/site`)
console.log(`  mean latency    ${Math.round(rows.reduce((n, r) => n + r.ms, 0) / rows.length)}ms`)
console.log(`  specs written   packages/ai/.evals/`)

// Gate: schema validity must be 100%. Everything else is a quality signal we watch.
const gateFailures = rows.filter((r) => r.findings.some((f) => f.rule === 'gate' || f.rule === 'schema'))
if (gateFailures.length) {
  console.error(`\n${gateFailures.length} brief(s) failed the validation gate: ${gateFailures.map((r) => r.id).join(', ')}`)
  process.exit(1)
}
