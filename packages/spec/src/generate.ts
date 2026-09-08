/**
 * S-02 — generate every downstream artefact from the component definitions.
 *
 *   packages/spec/src/components/*.ts   (the only source of truth)
 *        ├──► generated/website-spec.schema.json   the model's tool input_schema
 *        ├──► generated/catalogue.md               the cached prompt prefix
 *        └──► generated/manifest.json              the renderer's registry check
 *
 * CI runs this and fails on a diff, so a hand-edited generated file cannot survive.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { COMPONENTS } from './components/index.js'
import { WebsiteSpecification, SPEC_VERSION } from './spec.js'

const out = resolve(import.meta.dirname, '../generated')
mkdirSync(out, { recursive: true })

// ---- 1. JSON Schema, handed to the model as the emit_specification input_schema ----
const jsonSchema = zodToJsonSchema(WebsiteSpecification, {
  name: 'WebsiteSpecification',
  $refStrategy: 'none', // models handle a flat schema far more reliably than $refs
  target: 'jsonSchema7',
})
writeFileSync(resolve(out, 'website-spec.schema.json'), JSON.stringify(jsonSchema, null, 2) + '\n')

// ---- 2. Catalogue text for the cached prompt prefix ----
function describeProps(shape: Record<string, unknown>, indent = '  '): string {
  return Object.entries(shape)
    .map(([key, def]) => {
      const d = def as { _def?: { typeName?: string }; isOptional?: () => boolean }
      const optional = d.isOptional?.() ? '?' : ''
      return `${indent}${key}${optional}`
    })
    .join('\n')
}

let catalogue = `# Component catalogue (spec v${SPEC_VERSION})

You may only use the components and variants below. A component or variant that does not
appear here does not exist. Props not listed are rejected by the schema.

`
for (const c of COMPONENTS) {
  const shape = (c.props as unknown as { shape: Record<string, unknown> }).shape ?? {}
  catalogue += `## ${c.type}\n`
  catalogue += `variants: ${c.variants.join(' | ')}\n`
  catalogue += `props:\n${describeProps(shape)}\n`
  catalogue += `\n${c.aiGuidance.trim()}\n`
  if (c.industryDefaults && Object.keys(c.industryDefaults).length) {
    catalogue += `\ndefaults by industry: ${Object.entries(c.industryDefaults)
      .map(([k, v]) => `${k} → ${JSON.stringify(v)}`)
      .join('; ')}\n`
  }
  catalogue += `\n`
}
writeFileSync(resolve(out, 'catalogue.md'), catalogue)

// ---- 3. Manifest: the renderer asserts its registry covers exactly this list ----
writeFileSync(
  resolve(out, 'manifest.json'),
  JSON.stringify(
    {
      specVersion: SPEC_VERSION,
      components: COMPONENTS.map((c) => ({ type: c.type, variants: c.variants })),
    },
    null,
    2,
  ) + '\n',
)

const bytes = JSON.stringify(jsonSchema).length
console.log(
  `generated ${COMPONENTS.length} components · schema ${(bytes / 1024).toFixed(1)} KB · catalogue ${(catalogue.length / 1024).toFixed(1)} KB (~${Math.round(catalogue.length / 4)} tokens, cached)`,
)
