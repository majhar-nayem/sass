import manifest from '../stock/manifest.json' with { type: 'json' }
import { validateManifest, type StockManifest } from './stock.js'

/**
 * The manifest, imported rather than read from disk: `import.meta.dirname` is undefined
 * once a bundler processes the module, so a filesystem read here passes every test and
 * throws in the app.
 */
const checked = validateManifest(manifest)
if (!checked.ok)
  throw new Error(`stock/manifest.json is invalid:\n  ${checked.errors.join('\n  ')}`)

export const STOCK_MANIFEST: StockManifest = checked.manifest
