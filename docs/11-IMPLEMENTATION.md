# Awning — Implementation Plan

The build document. Everything here is executable: ~80 tickets with acceptance criteria,
in dependency order, sized in hours.

**Start: Monday 14 September 2026** (week 1 begins Mon; today, 8 Sep, is Day 0 setup week).
**Weeks 1–7 are unconditional.** The Track A / Track B fork is at week 8 and must be decided
by Friday 25 September — see `01-ROADMAP.md` §0.

> **Correction to the earlier costing.** Estimating this bottom-up, ticket by ticket, puts the core at
> **283 h — not the 230 h** the top-down workstream estimate produced. Bottom-up coming in higher is
> the normal direction, and the detailed number is the one to trust. Two consequences, both reflected
> below: the core takes **seven weeks solo, not six**, and Track A only works if the contractor takes
> the **core** component library from week 2, not just the extras. Section 13 carries the arithmetic.

---

## Progress — 20 September 2026

**Weeks 1–2 complete, a week early.** Sign up → create an org → the site and its
subdomain exist → publish → it renders on the tenant hostname. Verified over real HTTP.
**121 tests**, lint clean, both apps build.

```bash
pnpm install && pnpm db:up && pnpm db:migrate && pnpm --filter @awning/db seed:demo
pnpm verify
pnpm --filter @awning/app dev      # :3000 dashboard
pnpm --filter @awning/render dev   # :3001 tenant sites
curl -H "Host: daves-plumbing.awningsites.localhost" localhost:3001
```

| | Ticket | State |
|---|---|---|
| F-01…F-05 | Monorepo, Docker, migrations, RLS, CI | **done** |
| F-07 | Better Auth on the existing users table | **done** — signup works over HTTP |
| F-08 | Org, membership, `orgProcedure` | **done** |
| F-09 | Dashboard shell | **done** — placeholder UI until P-01 |
| **F-10** | **Isolation matrix generated from the router** | **done** — mutation-proven |
| S-01…S-03 | Spec package, generators, migrations | **done** |
| R-01, R-02 | Renderer, tenant resolution, subdomains | **done** |
| C-01…C-03 | Primitives, theming, `SectionBoundary` | **partial** — hero/services/cta |
| F-06 | Fly ×3 + Neon + Upstash | **deferred** — local Postgres/Redis, equivalent except deploy |
| F-11 | Sentry | **not started** — needs a DSN |
| **C-04** | **The remaining 7 components** | **next** — this is the contractor's parcel |

### Test counts by package
`@awning/tenancy` 71 · `@awning/spec` 32 · `@awning/db` 10 · `@awning/api` 8

### Corrections found by building

**The versioned cache key in `02-ARCHITECTURE.md` §7 cannot work as written.** The epoch
lives in Postgres and Prisma cannot run on Next's edge runtime, so middleware has no way
to learn it before the cache decision is taken. MVP is short `s-maxage` plus purge-by-URL.

**Every "no site here" state must return 404, not 200.** A placeholder with a 200 would
let Google index thin pages across the whole wildcard domain and hide outages from uptime
monitoring. Suspended sites 404 too.

**Better Auth's default id format breaks our schema.** Short random ids against a uuid
column fail on the first insert. Fixed with `generateId`, caught only because signup was
exercised over HTTP rather than assumed to work.

## 0. How to read a ticket

```
F-03  Prisma schema + first migration                        4h   ← F-02
      AC: `pnpm db:migrate` on a clean DB produces 31 tables; `prisma migrate
          diff --exit-code` is clean; seed inserts 3 plans.
```

`ID` · title · estimate · dependencies. **AC** is the acceptance criterion — a thing you can
run or look at, never "works properly". A ticket without a checkable AC is not ready to start.

Estimates are for a senior dev who knows this stack, and include tests and review.
They do **not** include learning a tool for the first time. Multiply by 1.5 for anything
you have not used before (most likely: Cloudflare for SaaS, Stripe Connect, Better Auth).

**Rules of engagement**
- One ticket in progress at a time. Finish, deploy, tick, next.
- Nothing merges to `main` without CI green.
- If a ticket runs 2× its estimate, stop and re-scope it rather than pushing through.
- Deploy to production every day from week 1, even when nothing user-visible changed.

---

## 1. Day 0 — accounts, DNS, secrets (half a day, do it this week)

Do this before Monday so week 1 is code, not signup forms.

### Domains
| Buy | Registrar | Purpose |
|---|---|---|
| `awning.au` | any AU registrar (needs ABN) | marketing + `app.` |
| `awningsites.com` | any | **tenant sites — must be a separate registrable domain** |

Both zones onto Cloudflare (**Pro plan on `awningsites.com`** — Cloudflare for SaaS needs it).

### DNS, set once
```
awningsites.com    CNAME  *   awning-render.fly.dev   proxied
awningsites.com    CNAME  @   awning-render.fly.dev   proxied
awning.au          CNAME  app awning-app.fly.dev      proxied
awning.au          CNAME  @   awning-web.fly.dev      proxied
```

### Accounts
Cloudflare (Pro) · Fly.io · Neon (`ap-southeast-2`) · Upstash Redis (Sydney) · Cloudflare R2 ·
Anthropic Console · Stripe (AU entity, **Connect enabled**) · Resend · Sentry · Axiom · PostHog · GitHub.

**2FA on every one of them before you put a key in it.**

### Two things people forget
1. **File the Public Suffix List submission for `awningsites.com` today.** It takes weeks to land and
   costs nothing. Without it, browsers let one tenant site set cookies for `.awningsites.com`.
2. **Email a lawyer today** for T&Cs, privacy policy, AUP and the tenant data-processing clause
   (~A$1,200, 2–3 week turnaround). It must exist before the first paying customer, which is week 8.

### Secrets (Fly secrets — never a committed `.env`)
```
DATABASE_URL  DIRECT_URL  REDIS_URL
ANTHROPIC_API_KEY
STRIPE_SECRET_KEY  STRIPE_WEBHOOK_SECRET  STRIPE_CONNECT_WEBHOOK_SECRET
CF_API_TOKEN            # scoped: 2 zones, Custom Hostnames + Cache Purge ONLY
CF_ZONE_ID_SITES  CF_ACCOUNT_ID
R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET
RESEND_API_KEY  TURNSTILE_SECRET
BETTER_AUTH_SECRET  SENTRY_DSN  AXIOM_TOKEN
APP_URL=https://app.awning.au
SITES_ROOT_DOMAIN=awningsites.com
AI_DAILY_CEILING_CENTS=4000
```

---

## 2. Repository scaffold

```bash
mkdir awning && cd awning && git init
pnpm init && pnpm dlx turbo@latest init
```

```
awning/
├─ apps/
│  ├─ app/            Next.js 15 — dashboard, onboarding, chat editor, tRPC
│  ├─ render/         Next.js 15 — tenant renderer. NO auth code. NO admin routes.
│  └─ web/            Next.js 15 — marketing + industry landing pages
├─ packages/
│  ├─ spec/           defineComponent, Zod props, generators, validators, migrations
│  ├─ ui-blocks/      the rendered components. Imports nothing from apps/.
│  ├─ ui-kit/         dashboard primitives (shadcn/ui)
│  ├─ db/             Prisma schema + client + withOrgContext
│  ├─ ai/             prompts, tools, router, cost meter, eval harness
│  ├─ integrations/   cloudflare, stripe, resend, r2
│  └─ config/         eslint, tsconfig, tailwind preset
├─ tests/             isolation matrix, e2e, guardrails
├─ docker-compose.yml postgres + redis + mailpit
└─ turbo.json
```

**The boundary that must hold:** `ui-blocks` imports from `spec` and nothing else. Enforce it:

```js
// packages/config/eslint/index.js
'no-restricted-imports': ['error', { patterns: [
  { group: ['@awning/db','@awning/ai','**/apps/**'],
    message: 'ui-blocks renders props. It knows nothing about tenants, auth or the database.' }]}]
```

---

## 3. The eight contracts to write before any feature

These are the interfaces everything else depends on. Write the signatures in week 1 even where the
bodies are stubs — changing them in week 5 is a refactor across every file.

```ts
// 1. packages/db — the ONLY way app code gets a client
export function withOrgContext<T>(orgId: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T>

// 2. packages/spec — a component is defined once, everything else is generated
export function defineComponent<T extends z.ZodTypeAny>(def: {
  type: SectionType; variants: readonly string[]; props: T
  aiGuidance: string; industryDefaults?: Partial<Record<Industry, object>>
}): ComponentDef

// 3. packages/spec — the gate. Nothing renders or persists without passing.
export function validateSpec(spec: unknown, ctx: ValidationCtx):
  { ok: true; spec: WebsiteSpec } | { ok: false; errors: SpecError[] }

// 4. packages/spec — forward compatibility from day one
export function migrateSpec(spec: AnySpec): WebsiteSpec

// 5. packages/ai — every model call goes through this. Meters before it awaits.
export function runAiAction(a: {
  orgId: string; siteId?: string; action: AiActionType
  model: Model; system: CachedPrefix; messages: Msg[]; tools?: Tool[]; maxTokens: number
}): Promise<AiResult>       // throws QuotaExceeded | CircuitOpen

// 6. packages/ai — an edit is tool calls, never a JSON patch string
export function applyEditTools(spec: WebsiteSpec, calls: EditToolCall[]):
  { spec: WebsiteSpec; applied: EditToolCall[]; rejected: {call; reason}[] }

// 7. apps/render — the hot path, every tenant request
export function resolveTenant(host: string): Promise<{siteId; orgId; epoch} | null>

// 8. everywhere — one publish path, one cache invalidation
export function publishSite(siteId: string, actor: Actor): Promise<{version; epoch}>
```

---

## 4. Weeks 1–2 · Foundation (14–27 Sep) — 75 h

**Milestone: a hard-coded spec renders at `test.awningsites.com` in under 300 ms, and the
cross-tenant isolation test passes.**

| ID | Ticket | h | Dep | AC |
|---|---|---|---|---|
| F-01 | Monorepo, Turbo, TS, eslint, Prettier, the `ui-blocks` import rule | 4 | — | `pnpm build` green; importing `@awning/db` from `ui-blocks` fails lint |
| F-02 | Docker Compose: Postgres 16, Redis, Mailpit | 2 | F-01 | `docker compose up` → app connects to all three |
| F-03 | Prisma schema from `schema/schema.sql` + migration + seed | 6 | F-02 | Clean DB → 31 tables; `migrate diff --exit-code` clean; 3 plans seeded |
| F-04 | `withOrgContext` + RLS policies + lint ban on bare `prisma.*` | 5 | F-03 | Query outside the helper returns 0 rows for another org's data |
| F-05 | GitHub Actions: typecheck, lint, unit, `migrate diff` | 3 | F-01 | PR with a type error fails |
| F-06 | Fly apps ×3 + Neon + Upstash, all Sydney; secrets loaded | 5 | F-02 | `/health` returns 200 on all three prod URLs |
| F-07 | Better Auth: email OTP, sessions, Google | 6 | F-03 | Sign up, sign out, sign back in; session survives redeploy |
| F-08 | Org + membership + `orgProcedure` tRPC middleware | 5 | F-04 F-07 | Every procedure resolves org from session; client-supplied `orgId` ignored |
| F-09 | Dashboard shell: nav, empty states, layout | 5 | F-08 | Signed-in user sees the shell; signed-out redirects |
| **F-10** | **Cross-tenant isolation matrix, generated from the router** | **6** | F-08 | Two seeded orgs; auth as A; every procedure against B's ids → `NOT_FOUND`/`FORBIDDEN`. A new procedure with no test **fails CI** |
| F-11 | Sentry both apps + worker; Axiom structured logs with `request_id` | 4 | F-06 | A thrown error appears in Sentry with org/site tags |
| S-01 | `packages/spec`: `defineComponent`, Zod prop schemas, shared `$defs` | 6 | F-01 | `hero` defined once; its Zod type infers correctly |
| S-02 | Generators: Zod → JSON Schema → TS types → AI catalogue text | 5 | S-01 | `pnpm gen:spec` writes all three; CI fails if they drift from source |
| S-03 | `migrateSpec` runner + a v1→v1 no-op test | 3 | S-01 | Round-trips a v1 spec unchanged |
| R-01 | Renderer app + `resolveTenant` middleware + Redis cache | 6 | F-06 S-01 | Unknown host → branded 404; known host → rewrite to `/_sites/{id}` |
| R-02 | `site_domains` + subdomain allocation + reserved blocklist | 4 | F-03 | `www`, `admin`, `xn--…` and profanity all rejected; collision appends `-2` |

75 h against 70 h available. Week 1 is the one week where enthusiasm covers a 5-hour overrun; do not
let it set a precedent.

**Week 2 exit gate.** All of the above deployed. F-10 green. If it is not, fix it before writing a
single component — a cross-tenant leak found in November is the end of the business.

---

## 5. Weeks 3–5 · Components & generation (28 Sep – 18 Oct) — 113 h

**Milestone: type a business description, get a website you would be willing to sell.**

Three weeks, not two. This is where the bottom-up estimate diverged most from the top-down one, and
it is the block that cannot be compressed: the component library is the product's surface.

| ID | Ticket | h | Dep | AC |
|---|---|---|---|---|
| C-01 | Primitives: `Section`, `Container`, `Heading`, `Button`, `Image`, icon sprite | 6 | S-01 | Rendered in Storybook; icon sprite is one inline SVG |
| C-02 | Theme custom properties, Tailwind preset, `autoContrast`, CSS value re-validation | 5 | C-01 | Changing `theme.primary` restyles the page; a non-hex value cannot reach the `<style>` block |
| C-03 | `SpecRenderer` + `SectionBoundary` + unknown-type-renders-null | 4 | C-01 R-01 | A section that throws hides itself and reports to Sentry; the rest of the page renders |
| C-04 | **10 core components** with variant tables | 28 | C-01 | Navbar, Hero, Services, About/ImageText, Contact, ContactForm, CTA, Footer, WhatsAppBubble, StickyCallBar. *(Gallery and LocationMap → backlog)* |
| C-05 | Storybook + **axe gate (0 violations)** in CI | 3 | C-04 | A contrast regression fails the build. *(Visual snapshots → backlog)* |
| C-06 | Stock image pool: ~40 × **4** industries, R2, tag, index | 3 | F-06 | `getStockPool('plumber')` returns 40 tagged, credited assets |
| R-03 | `/_sites/[siteId]/[[...slug]]` + cache headers + versioned cache key | 5 | C-03 R-01 | Second request is a Cloudflare HIT; `publishSite` bumps `cache_epoch` and the old object is unreachable |
| A-01 | Anthropic client: streaming, retry, **`ai_usage` written before the await** | 4 | F-03 | A timed-out call still records tokens and cost |
| A-02 | Cached prompt prefix: shared rules + catalogue + industry packs | 5 | S-02 A-01 | Cache-read ratio >85% across 10 consecutive calls |
| A-03 | `emit_specification` tool + Sonnet generation | 6 | A-02 | A one-line brief produces a spec that validates |
| A-04 | Validation pipeline: schema → semantic → banned claims → contrast → limits | 7 | S-02 A-03 | The 14 cases in `tests/spec-guardrails.mjs` all behave; invented testimonials rejected |
| A-05 | Retry-with-error-text ×2, then graceful failure keeping the old version | 3 | A-04 | Forced invalid output never persists and never renders |
| **A-06** | **Eval harness: 30 briefs, wired into CI** | **5** | A-04 | 100% schema validity, 0 banned claims, 0 placeholders, WCAG AA palettes, cost within budget. A prompt change that breaks any of these fails the build |
| **A-07** | **Quotas + per-org cap + rate limit + platform circuit breaker** | **6** | A-01 | Exceeding `ai_actions_month` returns a top-up offer, not a 500; daily spend over ceiling pauses generation and alerts |
| P-01 | Onboarding wizard, 7 questions, + resume-by-email | 7 | F-09 A-03 | Completes in under 3 min; a dropped session is resumable from the email |
| P-03 | Template system + **2** templates (Trade, Café/Food) | 6 | C-04 | Each renders end to end with placeholder substitution |
| P-04 | Publish / unpublish + subdomain allocation + first-publish email | 4 | R-03 R-02 | Publish completes in under 2 s; site live on its subdomain |
| **D-01** | **Demand probe: 10 real businesses, generated sites, on a laptop** | **6** | A-03 P-03 | Ten doors. Not pilots — no publishing, no handover, no support. Generate their site beforehand, show it, ask "would you pay A$39 a month for this?" Record the answer verbatim |

D-01 takes this block to 113 h against 105 available. **Take the overrun.** It is the cheapest possible
answer to the single risk most likely to kill the project, and it lands in week 5 rather than week 8 —
before the other 180 hours are spent. Two or three yeses and you build the rest with conviction; ten
polite nos and you have learned it for six hours instead of eight weeks.

**Week 5 exit gate — the one that decides whether to continue.** Generate 10 sites across 10
industries and **look at them**, then run D-01. If you would not walk into a business and show them,
stop and fix generation quality — nothing downstream compensates for a mediocre first render. If you
did show them and nobody leaned forward, that is the answer to a different and more important question.

---

## 6. Weeks 6–7 · The product (19 Oct – 1 Nov) — 69 h

**Milestone: an owner can change their site by typing, and a lead lands in their inbox.**

| ID | Ticket | h | Dep | AC |
|---|---|---|---|---|
| A-08 | Edit tool set + `applyEditTools` + per-call validation | 8 | A-04 | "Make the hero smaller" produces one `update_section`; a bad call is rejected without touching the others |
| A-09 | Intent router (Haiku) + spec-digest builder | 5 | A-08 | Edit context under 1.5k tokens; simple edits routed to Haiku |
| A-10 | `site_versions` write path + undo + restore | 5 | A-08 | Every accepted edit inserts a version; undo restores in under 1 s |
| P-05 | Chat editor UI, streamed, tool calls shown as plain English | 8 | A-08 | "Changed colours to dark green and gold" appears, not a JSON diff |
| P-06 | Live preview iframe, **reload-on-change** | 3 | C-03 P-05 | Preview updates within 2 s of an accepted edit; iframe sandboxed. *(postMessage highlight → backlog)* |
| P-07 | Asset upload: presigned R2, sharp re-encode, **EXIF strip**, logo | 6 | F-06 | A phone photo with GPS EXIF uploads with the EXIF gone |
| P-08 | Contact forms + Turnstile + honeypot + rate limit | 6 | R-03 | Submission stores, emails the owner, and survives a scripted flood |
| P-09 | Lead inbox: list, read, archive, CSV export | 5 | P-08 | Owner sees enquiries in the dashboard |
| P-10 | Click-to-call, WhatsApp CTA, sticky mobile call bar + click tracking | 4 | C-04 | Tap-to-call works on iOS and Android; clicks recorded |
| P-11 | SEO fields, sitemap.xml, robots.txt, JSON-LD LocalBusiness, OG images | 6 | R-03 | Rich Results Test passes for LocalBusiness |
| M-01 | Stripe Billing: 3 plans, Checkout, portal, webhooks + idempotency table | 8 | F-03 | Same webhook fired 3× creates one subscription |
| M-02 | **Publish gate on subscription status** | 2 | M-01 P-04 | Generation and preview are free; publish requires an active sub |
| O-01 | Custom domain **concierge**: an admin form that calls the Cloudflare API | 3 | F-06 | You attach a customer domain in under 5 min |

**Week 7 exit gate.** You can sign up as a stranger, describe a business, edit by chat, pay, publish,
and receive a test enquiry — without touching a database.

---

## 7. Backlog — deferred out of the core, scheduled week 9+ (32 h)

Cut deliberately to make weeks 1–7 fit, not forgotten. Each is genuinely deferrable; none is on the
path to a first paying customer.

| ID | Ticket | h | Why it waits |
|---|---|---|---|
| C-04b | Gallery + LocationMap components | 6 | A tradie site sells without either; a café wants the map |
| C-05b | Visual regression snapshots | 2 | The axe gate is the one that catches real damage |
| C-06b | Stock pools for 4 more industries | 3 | Only needed as you sell into them |
| A-06b | Eval harness 30 → 60 briefs | 3 | 30 catches regressions; 60 catches edge industries |
| A-11 | Deterministic fast path (text, colour, toggle, reorder) | 6 | Pure cost and latency optimisation. Worth doing by week 10 |
| P-02 | ABN lookup autofill | 3 | Delightful, not load-bearing |
| P-03b | 3rd template (Salon/Beauty) | 2 | Two templates cover the first ten customers |
| P-06b | postMessage section highlight in the preview | 3 | Reload works |
| O-02 | Admin console: impersonation, force-publish, quota override | 4 | You have database access and ten customers |

---

## 8. Week 8 fork (2–8 Nov)

### Track A — ecommerce and Christmas (63 h; only viable with a contractor)

Track A is available **only** if a contractor has been carrying the component library since week 2
(§13). Without that, the founder reaches this point at the end of week 7 with no capacity left and
Track A is arithmetically closed — this is the finding that the ticket-level estimate produced, and
it is why the hiring decision has a hard date of 25 September.

| ID | Ticket | h | AC |
|---|---|---|---|
| M-03 | Stripe Connect Standard onboarding | 6 | Tenant connects their own account; `stripe_account_id` stored |
| M-04 | Products, categories, images, CSV import | 10 | 40 products imported from a spreadsheet in one go |
| M-05 | Cart (signed HttpOnly cookie) + product/cart pages | 8 | Cart survives a reload and works on a CDN-cached page |
| M-06 | Stripe Checkout on the connected account + **Afterpay** | 6 | Test payment settles to the tenant's account, not yours |
| M-07 | Order webhooks, inventory decrement, confirmation emails | 6 | Duplicate webhook creates one order and decrements once |
| M-08 | GST: inclusive pricing, `gst_free` per product, receipt lines | 4 | A fresh-meat line shows no GST; a cooked line does |
| M-09 | Shipping rates, local pickup, local delivery by postcode | 6 | A butcher configures pickup-only in under 2 min |
| M-10 | **Pre-order / deposit kind + printable pickup run sheet** | 8 | Deposit now, collection date recorded, run sheet prints by date range |
| M-11 | Discount codes | 3 | `XMAS15` applies at Checkout, respects the expiry |
| X-01 | `apply_christmas_pack` tool + `/christmas` page generation | 6 | The gift-shop example from the brief produces a complete page |

**Contractor delivers in parallel:** the Christmas component set and 6 seasonal templates (X-02).

### Track B — pilots and polish (36 h)

| ID | Ticket | h | AC |
|---|---|---|---|
| B-01 | **Six free pilot builds with real Adelaide businesses** | 18 | Sit with each one. Write down every place they hesitate |
| B-02 | Fix only what the pilots exposed | 8 | Ranked by how many pilots hit it |
| B-03 | Christmas section pack: announcement bar, countdown, holiday hours | 8 | Countdown refuses to render without a real `endsAt` |
| B-04 | Marketing page + the public live demo (no signup) | 6 | Overflows into week 9 if the pilots run long — that is the correct trade |

### Both tracks, same week
| ID | Ticket | h | AC |
|---|---|---|---|
| X-03 | **27 Dec teardown email + one-click revert** | 4 | One click restores the pre-Christmas version |
| O-03 | Dunning: 7-day grace, 3 emails, owner-only banner, suspend at 14 | 5 | A failed payment never takes a site offline on day one |
| O-04 | Uptime canaries ×3 tenant hosts, AI spend dashboard, daily 7am digest | 5 | Renderer 5xx >0.5% for 2 min rings a phone |
| O-05 | Legal live: T&Cs, privacy policy, AUP, tenant privacy-policy generator | 4 | Every tenant site has a real privacy policy at `/privacy` |

Track A's week 8 is 63 + 18 = 81 h, which does not fit. **Move O-03/O-04/O-05 into week 9** on Track A
and accept that the first week of selling is a four-day week. Track B has room for all of it.

**Week 8 exit gate — the hard one.** Whatever exists on 8 November is what you sell for Christmas.
A Christmas feature shipped on 20 November has missed its market.

---

## 9. Weeks 9–13 · Sell (9 Nov – 8 Dec)

**Feature freeze.** The only work is what a paying customer is blocked on, plus the backlog in §7
when a day goes quiet.

| Week | Focus | Target |
|---|---|---|
| 9 · 9–15 Nov | 15–20 doors/day. Build the site *before* the visit. Convert the pilots. | 12 paying |
| 10 · 16–22 Nov | Referrals from every customer. Chambers, trade groups, Central Market traders. Ship A-11. | 25 paying |
| 11 · 23–29 Nov | **Annual prepay push** (2 months free) — every annual customer is a January churn removed. Load test + Lighthouse pass. | 38 paying |
| 12 · 30 Nov – 6 Dec | Last Christmas push to 1 Dec, then switch the message. Support only. | 45 paying |
| 13 · 7–8 Dec | Measure against `00-PRD.md` §8. Write the January retention plan. | — |

**Ship in these weeks only:** the self-serve domain wizard (O-06, 12 h — the largest single support
cost), the weekly digest email (O-07, 4 h — the largest single retention lever), the §7 backlog,
and bug fixes.

### The daily rhythm from week 9
Morning: read the 7am digest, clear support, fix anything a customer is blocked on.
Midday to 3pm: **doors.** This is the job now.
Late: publish the sites you sold, then one backlog ticket.

---

## 10. If you fall behind — the pre-committed cut order

Decide this now, while it is not 11pm on 20 November. Cut strictly in this order:

1. Everything in the §7 backlog stays deferred past December
2. The 3rd–12th templates → ship 2
3. Multi-page sites → single page with anchors
4. Version history UI → undo only
5. Three design directions → regenerate only
6. Analytics dashboard → embed Cloudflare Web Analytics
7. Seasonal templates → the Christmas section pack only
8. **Ecommerce entirely** → tradies, cafés and hospitality; refund any store deposits

**Never cut:** the isolation test (F-10), the AI circuit breaker (A-07), the eval harness (A-06),
mobile performance, or dunning grace (O-03). Each is cheap now and unrecoverable later.

---

## 11. Definition of done

**Per ticket:** AC demonstrably met · unit tests where there is logic · deployed to production ·
no new Sentry issues · no new axe violations · docs updated if a contract changed.

**Per phase:** the exit gate passes · CI fully green · you have used the feature yourself as a
customer would, on a phone.

**Per week (Friday, 30 minutes):** hours spent vs estimated · AI spend vs budget · support hours
and their top cause · tickets carried over. Three consecutive weeks of carry-over means the plan is
wrong, not the week — re-scope against §10 rather than working the weekend.

---

## 12. The first three days, concretely

**Monday 14 Sep** — F-01, F-02, F-05. End of day: `pnpm build` green in CI, Postgres and Redis
running locally.

**Tuesday 15 Sep** — F-03, F-04. End of day: 31 tables migrate on a clean database, RLS blocks a
cross-org read from a psql session.

**Wednesday 16 Sep** — F-06, then F-11. End of day: `/health` returns 200 on all three Fly apps in
Sydney, and a deliberately thrown error is visible in Sentry.

By Wednesday evening you have a deployed, monitored, multi-tenant-safe skeleton. Everything after
that is features on a foundation that already works in production — which is the only reliable way
to build something in thirteen weeks.

---

## 13. The arithmetic, so you can re-run it

| | Track B (solo) | Track A (with contractor from week 2) |
|---|---|---|
| Core, ticketed | 283 h | 283 h |
| Deferred to the §7 backlog | −32 h | −32 h |
| Absorbed by the contractor (C-04, C-05, C-06, P-03) | — | −45 h |
| **Founder core** | **257 h** | **212 h** |
| Weeks available before the fork | 7 (245 h) | 6 (210 h) |
| Demand probe D-01 | +6 h | +6 h |
| Fits? | tight | yes |
| Week 8 | pilots, 36 h | ecommerce + Christmas, 63 h |
| Founder total, weeks 1–13 | ~290 h of 455 | ~330 h of 455 |
| Contractor total | — | ~175 h (45 core + 130 extended) |
| Contractor cost | — | A$6–9k offshore, A$16–21k local |

The number that decides it: **Track A needs the contractor on core components from week 2.** A
contractor hired in week 6 to do "the extra components" does not free founder time in weeks 3–5,
which is where the core actually gets built, and Track A then closes arithmetically. That is the
whole reason the hiring decision has a hard date of 25 September rather than being left open.

---
