import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Load the repo-root .env without pulling in a dependency.
const envPath = resolve(import.meta.dirname, '../../../../.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    const [, k, rawV] = m
    if (!k || process.env[k]) continue
    process.env[k] = (rawV ?? '').replace(/^["']|["']$/g, '')
  }
}
