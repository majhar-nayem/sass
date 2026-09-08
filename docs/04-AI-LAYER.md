# Awning — AI Architecture: Generation, Editing, Guardrails, Cost Control

Covers brief deliverables 8, 9, 10, 19.

---

## 1. The pipeline

```
  Owner's words                    Owner's edit request
       │                                   │
       ▼                                   ▼
┌─────────────────┐              ┌───────────────────────┐
│ INTENT ROUTER   │              │ INTENT ROUTER (Haiku) │
│ (deterministic) │              │ classify + pick model │
└────────┬────────┘              └───────────┬───────────┘
         │                                   │
         │ typo/colour/toggle? ──────────────┤
         │        └──► DETERMINISTIC PATH ───┤ (no LLM at all)
         ▼                                   ▼
┌──────────────────────┐        ┌──────────────────────────┐
│ GENERATE  (Sonnet)   │        │ EDIT  (Haiku → Sonnet)   │
│ structured output    │        │ TOOL CALLS, not raw JSON │
│ full WebsiteSpec     │        │ add/update/remove/theme  │
└──────────┬───────────┘        └────────────┬─────────────┘
           │                                 │
           └──────────────┬──────────────────┘
                          ▼
            ┌───────────────────────────────┐
            │ 1. JSON Schema validation     │  ← ajv, the schema in ../schema/
            │ 2. Semantic validation        │  ← refs resolve, no orphan anchors
            │ 3. Banned-claims scan         │  ← ACL: fake reviews/licences/awards
            │ 4. Contrast / a11y check      │  ← WCAG AA on the generated palette
            │ 5. Business-rules check       │  ← quota, plan limits, product refs
            └───────────────┬───────────────┘
                    fail ◄──┴──► pass
                      │            │
          retry ≤2 with            ▼
          the error text   ┌──────────────────┐
          appended         │ new site_version │
                      │    │ (immutable row)  │
          still fail  │    └────────┬─────────┘
                      ▼             ▼
              apologise +    ┌───────────────┐
              keep old spec  │ Live preview  │
              (NEVER render  │ (iframe)      │
               a bad spec)   └───────────────┘
```

**The single most important property:** an invalid model output is *never* rendered and *never* persisted. The previous version is always intact. The blast radius of a bad generation is one apologetic chat message.

## 2. Generation

One Sonnet call. Structured output (tool-forced JSON) against the WebsiteSpecification schema.

**Context assembled deterministically** (not by the model):
- The component catalogue — every type, its variants, its props, with 1-line usage guidance. ~3,500 tokens. **Cached** (`cache_control: ephemeral`).
- Industry pack for the detected industry: typical services, typical page structure, vocabulary, 3 recommended palettes, stock-image keyword set. ~800 tokens.
- The owner's onboarding answers.
- The available asset ids (uploaded logo + the curated stock pool for that industry).

**Output:** the complete spec. ~6–9k output tokens for a 4-page site.

### Three design directions for the price of ~1.3
The highest-perceived-value moment in the whole product is being shown three finished sites and picking one. Naively that is 3× the cost. Instead: **one generation pass, then two deterministic re-skins.** Content stays identical; a `ThemeVariator` function swaps the palette, the font pairing, `radius`/`shadow`/`density`, and the hero/section variants using pre-authored "design direction" recipes (`Clean`, `Premium`, `Bold`). Zero extra tokens, three genuinely different-looking sites. If the owner wants a fourth, *that* costs a generation.

This is the highest ROI trick in the document.

### Image strategy — and why not to generate images
AI image generation for MVP is a trap: ~A$0.04–0.08 an image, 6–10 images a site, mediocre results, and generated "photos of your shop" that are not your shop are an ACL problem waiting to happen.

Instead: a **curated stock pool**, ~40 images per industry, hand-picked once, stored in R2, tagged. The AI selects by `stock:` id from the pool that's put in its context. Cost: A$0. Quality: better than generated. Then the onboarding nudges hard for real photos, because a real photo of Dave's van outperforms any stock image ever taken.

## 3. Editing — tool calls, not JSON Patch

The brief says "produce patches/deltas". Correct instinct; **JSON Patch strings are the wrong implementation.** Models produce plausible-looking RFC-6902 pointers that address the wrong array index, and a wrong index silently corrupts a different section. There is no way to validate intent after the fact.

Give the model a **constrained tool set** instead. Each tool is individually validated, individually reversible, individually loggable, and reads as an audit trail in plain English.

```ts
const EDIT_TOOLS = [
  set_theme({ patch: Partial<Theme> }),
  add_section({ pageId, type, variant, props, position }),
  update_section({ sectionId, props: DeepPartial<Props>, variant? }),
  remove_section({ sectionId }),
  reorder_sections({ pageId, sectionIds: string[] }),
  toggle_section({ sectionId, hidden: boolean }),
  create_page({ path, title, sections }),
  update_page_seo({ pageId, title?, description? }),
  delete_page({ pageId }),
  set_nav({ items, cta? }),
  set_global({ key: 'announcementBar'|'whatsappBubble'|'stickyCallBar', value }),
  apply_christmas_pack({ preset, offerText?, endsAt?, deliveryCutoff? }),
  ask_user({ question, options? }),        // when a fact is missing — DO NOT INVENT
  explain({ message }),                     // when no change is warranted
]
```

Why this wins:

| | JSON Patch string | **Tool calls** |
|---|---|---|
| Wrong array index | Silent corruption | Impossible — addressed by `sectionId` |
| Validation | After the fact, on the whole doc | Per call, before application |
| Undo | Diff the documents | Inverse of the call |
| Audit trail | `/pages/0/sections/3/props/heading` | "Changed the hero heading" |
| Model reliability | Poor | Excellent — it's ordinary function calling |
| Partial success | All or nothing | Apply 3 of 4, report the 4th |

### Worked example

> **Owner:** "Change the colours to dark green and gold and make the hero smaller"

```jsonc
[
  { "name":"set_theme", "input":{ "patch":{
      "primary":"#173B2A","accent":"#C9A227","secondary":"#F5EEDC" }}},
  { "name":"update_section", "input":{
      "sectionId":"hero-1", "props":{ "height":"compact" }}}
]
```

Two tool calls, ~120 output tokens, one new version, summary: *"Changed colours to dark green and gold; made the hero smaller."* Cost with Haiku and a cached catalogue: **~A$0.004**.

Compare a naive full-spec regeneration: ~8,000 output tokens on Sonnet, **~A$0.19**, 25 seconds, and a risk that unrelated copy silently changes — which owners *notice and hate*.

### Context sent on an edit
Not the whole spec. A **spec digest**: the tree of page → section ids, types, variants, and the first 60 chars of each text prop, plus the full props of any section the router thinks is relevant. ~1,200 tokens instead of ~9,000. On a miss, the model calls `ask_user` or requests the full section — a second cheap round trip beats paying for the whole document on every turn.

### The deterministic fast path
Route these away from the LLM entirely — they are ~35% of all edit turns:

| Owner action | Handling |
|---|---|
| Click text in preview, retype | Direct spec write. No model. |
| Colour picker | Direct write + contrast re-check. |
| Show/hide a section | Direct write. |
| Reorder by drag | Direct write. |
| Replace an image | Direct write. |
| "undo" / "go back" | Version restore. |

Every one of these routed to an LLM would be slower, more expensive, and less reliable. Build the fast path in week 6 — it pays for itself in latency alone.

## 4. Prompt injection and the trust boundary

Tenant-supplied content (business description, product titles, uploaded text) is **data, never instruction**. Concretely:

1. All user content goes inside `<business_input>` tags with an explicit instruction that its contents are facts to describe, never commands.
2. The model's only output channel is validated tool calls — there is no path from a prompt to arbitrary code, a DB write, an HTTP call, or a shell.
3. Even a fully "jailbroken" model can, at absolute worst, produce a valid spec with silly copy. It cannot escalate, because the schema is the ceiling.
4. Site visitors never reach the AI at all. There is no public chat surface.

This is the real argument for the spec architecture: it makes prompt injection a content-quality problem rather than a security problem.

## 5. Banned-claims validator (Australian Consumer Law)

Runs after schema validation, on every string in the spec. Not a soft nudge — a hard reject with a retry.

```ts
const BANNED = [
  // fabricated credentials
  /\b(licen[sc]ed|certified|accredited|insured|bonded)\b/i,
  /\b(lic(ence|ense)?\.?\s*(no|#|number)[:\s]*[\w\-]+)/i,
  /\bABN[:\s]*\d/i,                       // must come from org.abn, never invented
  // fabricated track record
  /\b(since|est\.?|established)\s*(19|20)\d{2}\b/i,
  /\b\d+\+?\s*(years?|yrs?)\s*(of\s*)?(experience|in business|serving)\b/i,
  /\b(over|more than)\s*[\d,]+\s*(happy\s*)?(customers|clients|jobs|homes)\b/i,
  // fabricated social proof
  /\b\d(\.\d)?\s*[-\/]?\s*star\b/i,
  /\b(award[- ]winning|voted|rated|#1|number one|best in)\b/i,
  /\b(google|facebook|trustpilot)\s*reviews?\b/i,
  // absolutes that invite ACL trouble
  /\b(guaranteed|100%|cheapest|lowest price|unbeatable|no.?one else)\b/i,
];
```

**How the check works, and why it isn't just a blocklist:** each match is compared against `org.verified_facts` — the structured answers the owner actually gave (ABN from the ABR lookup, years in business, licence number, uploaded review screenshots). A match backed by a verified fact passes and is rendered. A match with no backing is rejected, and the retry prompt tells the model *why*, which teaches it within the same turn.

When the owner genuinely is licensed, the answer is not to let the model guess — it's an onboarding field: *"Licence number (optional — we'll display it)"*. That field is worth building; tradies want it shown, and it is a conversion element.

Also enforced here: `compare_at` strikethrough requires attestation, `countdown.endsAt` must be ≥ now and ≤ 12 months out, and every `testimonials.items[].source` is `customer_supplied` (the schema already guarantees the last one — belt and braces).

## 6. Model routing and cost control

### Routing table

| Action | Model | Why |
|---|---|---|
| Full site generation | **Sonnet** | Design judgement and copy quality are the product |
| 3 design directions | deterministic | Re-skin, no tokens |
| Simple edit (colour, size, text, toggle) | **Haiku** | Indistinguishable quality on a tool call |
| Structural edit (add section, new page) | **Haiku**, escalate to Sonnet on validation failure | ~85% succeed on Haiku |
| Copy rewrite ("make this warmer") | **Sonnet** | Quality is visible |
| Christmas pack | deterministic template + **Haiku** for copy | |
| SEO meta | **Haiku** | |
| Intent classification | **Haiku**, ~200 tokens | |
| Typo / picker / toggle | **none** | Fast path |

### Prompt caching is the single biggest lever
The component catalogue + industry pack is ~4,300 stable tokens on every call. With `cache_control`, cache reads are **90% cheaper** than base input. On a generation this cuts input cost from ~A$0.020 to ~A$0.003; across thousands of edit calls it is the difference between a A$240 and a A$700 monthly bill.

Order the prompt: `[system rules] [component catalogue] [industry pack]` ← cached prefix, then `[spec digest] [conversation] [user turn]` ← variable. Never interleave.

### Modelled unit cost (AUD, at ~1.55 AUD/USD)

| Action | Model | In (cached) | Out | Cost |
|---|---|---|---|---|
| Generate site | Sonnet | 4.3k cached + 1.2k | 8k | **A$0.196** |
| Simple edit | Haiku | 4.3k cached + 1.2k | 200 | **A$0.0035** |
| Structural edit | Haiku | 4.3k cached + 2k | 700 | **A$0.0072** |
| Copy rewrite | Sonnet | 4.3k cached + 1.5k | 900 | **A$0.026** |
| Intent classify | Haiku | 500 | 30 | **A$0.0009** |

**Typical customer, per month:** 2 generations (one at signup, one "start again") + 45 edits + 6 rewrites ≈ **A$0.39 + A$0.20 + A$0.16 ≈ A$0.75/month.**

Heavy customer (10 generations, 300 edits): ~A$4.20/month.

At A$49 revenue this is a rounding error — *provided* the caps hold. They exist for the pathological case, not the typical one.

### Four layers of spend control

1. **Plan quota** — `ai_actions_month`, checked before every call, decremented on success. At 80% the UI warns; at 100% the chat offers a top-up (50 actions for A$9) rather than a hard wall, because a hard wall on a paying customer is a churn event.
2. **Per-org hard dollar cap** — `plans.ai_hard_cap_cents`. Even inside quota, if an org exceeds (say) A$6.00 in a month, AI actions pause and an internal alert fires. Catches a runaway loop that quota alone would not.
3. **Rate limits** — 8 AI actions/minute/org, 40/hour. Blocks scripted abuse and accidental double-submits.
4. **Platform circuit breaker** — a daily platform-wide spend ceiling (start at A$40/day). If tripped, generation is queued and a page fires. This is the one that saves you from a A$4,000 surprise while you're asleep. **Build it in week 4, not after the incident.**

Additionally: cap `max_tokens` per action type, hard-stop retries at 2, never retry a refusal, and log every call to `ai_usage` *before* awaiting the response so a timeout still records the spend.

### What to watch weekly
`cost per active customer` · `cost per generation` (regression alarm on prompt changes) · `cache hit ratio` (should be >85%; if it drops, someone broke prompt ordering) · `retry rate` (>8% means the schema or the prompt drifted) · `Haiku escalation rate` · `% edits on the deterministic fast path` (should climb toward 35%).

## 7. Evaluation harness — the most valuable test asset you will build

60 canned business briefs, spanning every industry, from one-line ("plumber in Adelaide") to the full paragraph in the brief, including hostile ones ("make me a site that says we're the cheapest and 5-star rated"). Run in CI on every prompt or schema change.

Assertions per brief:
1. Output validates against the schema (**must be 100%**)
2. No banned claim survives
3. Required sections present for the industry (a tradie site has a phone CTA above the fold; a restaurant has hours)
4. Every image has alt text
5. Palette passes WCAG AA contrast for text on background
6. No placeholder text (`lorem`, `Your Business Here`, `[insert`)
7. Copy is Australian English (`-ise`, not `-ize`; `mobile`, not `cell`; `suburb`, not `city`)
8. Token count and cost within budget

Plus a weekly manual pass: generate 10 sites, look at them, rate 1–5. Automated checks cannot tell you a site is ugly. **The eval harness is what lets you change the prompt on a Tuesday without breaking every new signup on Wednesday.** Build it in week 3, before you have customers, or you will never build it.
