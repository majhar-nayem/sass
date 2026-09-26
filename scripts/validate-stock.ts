/** Runs in CI: an uncredited Unsplash entry must fail the build, not a customer's site. */
import manifest from '../packages/spec/stock/manifest.json' with { type: 'json' }
import { validateManifest } from '@awning/spec'

const r = validateManifest(manifest)
if (!r.ok) {
  console.error('stock/manifest.json is invalid:')
  for (const e of r.errors) console.error(`  - ${e}`)
  process.exit(1)
}
const byKind = r.manifest.entries.reduce<Record<string, number>>((acc, e) => {
  acc[e.kind] = (acc[e.kind] ?? 0) + 1
  return acc
}, {})
console.log(`stock manifest OK — ${r.manifest.entries.length} entries (${JSON.stringify(byKind)})`)
