# Awning — 13-Week Roadmap & Exact Development Order

Covers brief deliverables 3 and 28. **Start: Tue 8 September 2026. End: Mon 8 December 2026.**

---

## 0. Capacity check — read this before anything else

13 weeks × ~35 productive hours = **~455 developer hours.** Honest estimate of the full brief:

| Workstream | Hours |
|---|---|
| Foundation: auth, DB, dashboard shell, CI/CD, deploy | 50 |
| Component library — 31 components × variants, Storybook, axe | 80 |
| Spec system: Zod → JSON Schema → types, validators, migrations | 30 |
| AI generation: prompts, catalogue, eval harness | 45 |
| AI editing: tool calls, router, versioning, undo | 40 |
| Renderer: multi-tenancy, caching, SEO, sitemap, OG | 40 |
| Onboarding wizard + 12 templates | 40 |
| Chat editor UI + live preview | 30 |
| Forms, inbox, transactional email | 25 |
| Domains: subdomain + custom-domain state machine | 30 |
| Stripe subscription billing + dunning | 25 |
| **Ecommerce: products, cart, checkout, orders, shipping** | **70** |
| Christmas pack: components + 6 templates | 25 |
| Security hardening + the test suites | 40 |
| Marketing site + 8 industry landing pages | 25 |
| Monitoring, runbooks, admin console | 15 |
| **Total** | **610** |

**610 needed against 455 available — a ~35% overrun, and that is before a single hour of selling, support or bug-fixing.** Manually acquiring 50 customers is 60–80 hours on its own. The realistic gap is closer to 55%.

`11-IMPLEMENTATION.md` re-estimates the same work bottom-up, ticket by ticket. It comes out **higher**, which is the normal direction: the Ship-10 core alone is **283 h, not 230 h**. Everything below uses the ticket-level numbers.

### The decision, and where it actually forks

The temptation is to treat this as one big scope choice. It isn't. **Weeks 1–7 are identical in every
version of this product** — foundation, spec system, renderer, the ten core components, generation,
chat editing, forms, publishing. That work is unconditional. Start it on Monday and stop deliberating.

The fork is at **week 8**, and it is a hiring decision rather than an architecture one:

| | **Track A — with a contractor** | **Track B — solo** |
|---|---|---|
| Extra hands | One React/Tailwind contractor, **from week 2**, ~175 h: the **core** component library and first templates (45 h), then the 19 extra components, 9 templates and the Christmas set (130 h) | None |
| Cost | A$6–9k offshore, A$16–21k local. The spec architecture makes this parcel unusually easy to specify and accept — you review props and screenshots against an axe gate, not opinions | A$0 |
| Week 8 | Founder builds ecommerce and Christmas: Connect, Checkout, orders, shipping, pre-orders, `apply_christmas_pack` | Founder builds nothing new; six pilots, then sells |
| Market reached | Trades **and** food/gift retail — the segment with a real December deadline and A$899 setup budgets | Trades, cafés and hospitality only |
| Founder hours, weeks 1–13 | ~330 of 455 | ~290 of 455 |
| Risk | Contractor quality, and ~2 weeks of your time managing them | Leaves the highest-paying Christmas segment on the table |

**The load-bearing detail:** the contractor must take the **core** component library from week 2, not
just the extras. Weeks 3–5 are where the core actually gets built; a contractor hired in week 6 to do
"the extra components" frees no founder time there, and Track A closes arithmetically. Full working in
`11-IMPLEMENTATION.md` §13.

**Decide by Friday 25 September (end of week 2)** — and start the search this week. Finding, trialling
and briefing a contractor takes two weeks, and they need to be productive by week 2 for the arithmetic
above to hold. If the money isn't there by
week 2, that is a clean Track B and the plan still works.

**Do not attempt the full brief solo.** 610 hours into 455 produces something 80% finished in every
direction on 1 December, which is worth nothing in the one month that cannot slip.

## 1. The Christmas deadline is earlier than it looks

The brief puts the Christmas launch in Month 3. Work backwards from how Australian small businesses actually trade:

```
22–24 Dec   Pre-orders collected. Shops flat out. Nobody is buying software.
10–24 Dec   Retail peak.
~1 Dec      Last date a new site can meaningfully influence Christmas trade.
15–30 Nov   Christmas pre-orders are PLACED. The site must be live and indexed.
 1–15 Nov   Owner decides, buys, gets set up. ← THE SELLING WINDOW
15–31 Oct   Owner starts thinking about Christmas. ← FIRST CONTACT
 2 Nov      ⇒ Christmas + commerce features must be SHIPPABLE.  ← end of week 8
```

A Christmas launch in Month 3 means selling in late November, by which point the decision has been made and the money spent. **Christmas features move to weeks 6–7.** Month 3 becomes selling, support and reliability — which is what Month 3 should be anyway.

Also plan for the other side of it: **Australia shuts down from ~20 December to ~20 January.** New sales go to near zero, and Christmas-motivated buyers churn in January. That is modelled in `09-GTM-FINANCE.md`, not hoped away.

## 2. Week-by-week

### Phase 1 — Foundation (weeks 1–2 · 14–27 Sep · 75 h)
Monorepo, CI, Fly ×3 in Sydney, Neon, Cloudflare zones, wildcard DNS, PSL submission filed, Better Auth,
org/membership, Prisma + RLS, **the cross-tenant isolation test**, the spec package, the renderer and its
hostname resolver, versioned cache key, Sentry.

**Gate:** a hard-coded spec renders at `test.awningsites.com` in under 300 ms, and the isolation test passes.

### Phase 2 — Components & generation (weeks 3–5 · 28 Sep – 18 Oct · 107 h)
The 10 core components with variant tables, theme custom properties, Storybook + axe gate, stock image
pool, AI generation on Sonnet with a cached catalogue, the validation pipeline, **the eval harness**,
**the AI circuit breaker**, onboarding wizard, 2 templates, publish + subdomain.

Three weeks, not two. This is the block that cannot be compressed — the component library is the
product's entire surface.

**Gate:** generate 10 sites across 10 industries and look at them. If you would not walk into a business
and show them, stop here.

### Phase 3 — The product (weeks 6–7 · 19 Oct – 1 Nov · 69 h)
Chat editor and edit tool calls, intent router, versioning and undo, live preview, image and logo upload,
contact forms + Turnstile + inbox, WhatsApp and sticky call bar, SEO + JSON-LD, Stripe subscriptions and
the publish gate, custom-domain concierge.

**Gate:** sign up as a stranger, describe a business, edit by chat, pay, publish, receive a test
enquiry — without touching a database.

### Phase 4 — The fork (week 8 · 2–8 Nov)

**Track A — ecommerce and Christmas (63 h).** Products, Connect Standard, Checkout + Afterpay, orders,
shipping, local pickup, **pre-orders with deposits**, the pickup run sheet, discount codes,
`apply_christmas_pack`. Contractor delivers the Christmas components and 6 seasonal templates in parallel.
*Available only if the contractor has been on core components since week 2.*

**Track B — pilots and polish (36 h).** Six free pilot builds with real Adelaide businesses. Sit with
them. Fix only what they expose. Ship the three-component Christmas section pack and the public demo.

**Both:** dunning, monitoring and alerts, the 27 December teardown email, legal live.

**Gate:** whatever exists on 8 November is what you sell for Christmas.

### Phase 5 — Sell (weeks 9–12 · 9 Nov – 6 Dec)
**Feature freeze except what a paying customer is blocked on.**

- Door-knock, phone, chamber of commerce, trade Facebook groups, industry associations, halal/multicultural business networks.
- 15–20 outbound contacts a day. Build the site *before* the pitch — walk in with their website already made.
- Convert the pilots to paid. Ask every single customer for a referral.
- Ship only: bug fixes, the self-serve custom domain wizard, the weekly digest email, dunning.
- W11: load test, Lighthouse pass, the Christmas traffic dry run. Annual-prepay push.

**Gate:** 25 paying customers by 22 November.

### Phase 6 — Hold the line (week 13 · 7–8 Dec)
- Support, support, support. December uptime is the whole reputation.
- Last sales push to 1 December, then stop selling Christmas and start selling "get set up before the new financial year rush".
- Write the January retention plan *now*, while you still have attention.
- 8 December: measure against `00-PRD.md` §8.

## 3. Exact development order

Strictly dependency-ordered. Do not start N before N−1 is deployed and working.

**Foundation**
1. Monorepo (pnpm workspaces), TS config, eslint, Prettier
2. Docker Compose local: Postgres, Redis, Mailpit
3. GitHub Actions: typecheck, lint, test
4. Fly apps ×3 (`app`, `render`, `worker`) + Neon + Upstash, all `syd`/`ap-southeast-2`
5. Cloudflare zones, wildcard DNS, Universal SSL; **file the PSL submission for `awningsites.com`**
6. Prisma schema + first migration (`schema/schema.sql`)
7. RLS policies + `withOrgContext` + lint rule banning bare `prisma.*`
8. Better Auth: email OTP, session, org, membership
9. Dashboard shell, nav, empty states
10. **Cross-tenant isolation test, generated from the router** ← before any feature

**Spec & renderer**
11. `packages/spec`: `defineComponent`, Zod props, `$id`s
12. Generators: Zod → JSON Schema, → TS types, → AI catalogue text
13. Spec migration runner + a no-op v1→v1 test
14. Renderer app + middleware hostname resolver + Redis cache
15. `site_domains` + subdomain allocation + reserved-word blocklist
16. `/_sites/[siteId]/[[...slug]]` + `SpecRenderer` + `SectionBoundary`
17. Theme custom properties + Tailwind preset + `autoContrast` + CSS value re-validation
18. Cache headers + versioned cache key + `cache_epoch` bump on publish

**Components**
19. Primitives: `Section`, `Container`, `Heading`, `Button`, `Image`, `Icon` sprite
20. The 12 P0 components + variant tables
21. Storybook + Chromatic-style snapshots + axe gate in CI
22. The next 8 components
23. Stock image pool: curate, upload to R2, tag, index

**AI**
24. Anthropic client, streaming, retry, `ai_usage` logging **before** the await
25. Cached prompt prefix: shared rules + catalogue + industry packs
26. `emit_specification` tool + Sonnet generation
27. Validation pipeline: schema → semantic → banned claims → contrast → business rules
28. Retry-with-error-text, max 2, then graceful failure
29. **Eval harness, 60 briefs, wired into CI** ← before customers, or never
30. **Quotas, per-org cap, rate limit, platform circuit breaker** ← before customers, or expensive
31. Edit tool set + application + validation per call
32. Intent router (Haiku) + spec digest builder
33. `site_versions` + undo + restore
34. Deterministic fast path

**Product surface**
35. Onboarding wizard (7 questions) + ABN lookup + resume-by-email
36. Template system + the first 6 templates
37. Three design directions (deterministic re-skin)
38. Chat editor UI + streaming + preview iframe + postMessage highlight
39. Asset upload: presigned R2, sharp re-encode, EXIF strip
40. Publish / unpublish + first-publish email
41. SEO fields, sitemap.xml, robots.txt, JSON-LD, dynamic OG images
42. Contact forms + Turnstile + honeypot + inbox + notification email
43. WhatsApp CTA + sticky call bar + click tracking

**Money**
44. Stripe Billing: plans, Checkout, portal, webhooks + idempotency table
45. Publish gate on subscription status
46. Dunning: 7-day grace, emails, banner, then suspend
47. Cloudflare custom hostnames API + domain state machine worker
48. Domain wizard UI + the 8 human error messages
49. Stripe Connect Standard onboarding
50. Products, categories, images, CSV import
51. Cart (signed cookie) + Stripe Checkout + Afterpay
52. Order webhooks + inventory decrement + emails
53. Shipping rates, pickup, local delivery, discount codes
54. Pre-order/deposit product kind + pickup run sheet

**Christmas**
55. Christmas components + `apply_christmas_pack` tool
56. 6 seasonal templates
57. `/christmas` page generation + delivery cutoff + holiday hours

**Launch**
58. Marketing site + 8 industry landing pages
59. Legal: T&Cs, privacy policy, AUP, tenant privacy-policy generator
60. Admin console: impersonate (audited), force-publish, quota override
61. Monitoring, alerts, daily digest, runbooks
62. Load test + Lighthouse + the December dry run

## 4. Kill criteria — decide these now, in the calm

Pre-committing to these is what stops a sunk-cost decision in November.

| Checkpoint | If this is true | Then |
|---|---|---|
| **8 Nov (end W8)** | Fewer than 3 pilots have published a site they're proud of | Stop building. The generation quality is the product; nothing downstream fixes it. |
| **8 Nov (end W8)** | Ecommerce isn't working end-to-end | Drop it. Sell to tradies only. Refund any store deposits. |
| **22 Nov (end W11)** | Fewer than 10 paying customers | The problem is distribution, not product. Stop building features entirely and sell for two weeks. |
| **8 Dec** | Fewer than 10 paying customers | Do not push on into January on hope. Run the post-mortem, decide deliberately whether the wedge was wrong or the market is. |
