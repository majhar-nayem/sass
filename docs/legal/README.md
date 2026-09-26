# Legal documents (O-05b)

**These are drafts prepared by an engineer, not a lawyer, and they are not legal
advice.** They exist so that the money budgeted for legal review (PRD assumption A3,
~A$1,500) buys a review rather than a first draft, which is a materially cheaper
engagement. Nothing here should be published until a practising Australian solicitor
has reviewed it.

| File | What it is | Status |
|---|---|---|
| `TERMS.md` | Platform terms of service — Awning and the business that subscribes | **draft, unreviewed** |
| `ACCEPTABLE-USE.md` | What a customer may not publish or do with a site | **draft, unreviewed** |
| `LAWYER-BRIEF.md` | The decisions only a lawyer can make, and why each one matters | ready to send |
| `TAKEDOWN-RUNBOOK.md` | What to do when someone reports a customer's site | **draft, unreviewed** |

Awning's own privacy policy is **not** here. It is the one document that should be
drafted by the lawyer from the start rather than reviewed, because it turns on how the
Privacy Act applies to this business — see `LAWYER-BRIEF.md` §2.

Tenant privacy policies are a different thing again: generated per site from what that
site actually collects, in `packages/spec/src/privacy-policy.ts` (O-05).

## How these become live text

These `.md` files are the source of truth. `pnpm gen:legal` compiles them into
`packages/api/src/legal/generated.ts` with a SHA-256 of each document, and CI fails if
the generated file is stale — the same arrangement as the spec catalogue.

The hash matters: acceptance is recorded against it, so it is always possible to show
exactly which words a given customer agreed to. Editing a document after someone has
accepted it does not rewrite what they accepted.

```bash
pnpm gen:legal      # after editing any document here
```

Bump `version` in the document's front matter for a **material** change — that is what
forces existing customers to accept again. A typo fix should not.
