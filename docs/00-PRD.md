# Awning — Product Requirements Document

> **Codename:** Awning (placeholder — the thing above every Australian shopfront). Short, ownable, unmistakably small-business.
> **Owner:** Majharul / Accept Global
> **Date:** 8 September 2026
> **Status:** Pre-build. This document is the contract for what gets built before 8 December 2026.

---

## 0. Assumptions this plan is built on

State these explicitly, because if any is wrong the plan changes materially.

| # | Assumption | If wrong |
|---|---|---|
| A1 | Build capacity is **1 senior full-stack dev working ~35 productive hrs/week** (you), optionally +1 contractor for the component library in weeks 3–6. | With 2 full-time devs, pull ecommerce forward 3 weeks. With <20 hrs/week, cut to Ship-10 (§ `10-SHIP10.md`) and drop ecommerce entirely. |
| A2 | You can personally sell. First 20 customers come from door-knocking, phone and referral in Adelaide. | If sales must be inbound/paid, add 6 weeks and A$3–5k ad budget; 3-month targets become unachievable. |
| A3 | Budget for infra + tools is A$100–500/mo, plus ~A$1,500 one-off for legal (T&Cs, privacy policy, tenant terms). | Legal is non-optional; you are a data processor for tenant customer data. |
| A4 | Anthropic API (Claude) is the model provider. Sonnet for generation, Haiku for edits. | Any frontier model works; the spec/tool-call architecture is provider-agnostic. |
| A5 | Money for tenant ecommerce sales flows **directly to the tenant's own Stripe account** via Stripe Connect Standard. The platform never holds tenant funds. | If the platform collects and remits, you become a payment facilitator — AUSTRAC registration, ASIC exposure, trust-account obligations. Do not do this. |

---

## 1. Problem

An Australian sole trader or small retailer needs a website. Their real options today:

- **Do nothing.** ~40% of Australian small businesses have no website or a dead Facebook page. Most common outcome.
- **Hire a local agency.** A$2,500–8,000 up front, 4–8 weeks, then A$100+/mo and a $150 invoice to change the phone number.
- **DIY on Wix/Squarespace/GoDaddy.** A$25–50/mo, plus 10–20 hours the owner does not have, plus a design outcome they are quietly embarrassed by.
- **A cousin who "does websites".** Ships in 3 months or never; no one can maintain it.

The gap is not price and it is not templates. It is **elapsed time and cognitive load**. A plumber does not want a website editor. They want a website.

## 2. Value proposition

> **"Tell us about your business. We build your website, write the words, put it online today."**

Secondary line for the Christmas campaign:

> **"Your Christmas website, live this week."**

## 3. Target customer (initial)

**Primary — Ship-10 wedge:** Adelaide local-service businesses, sole trader to 8 staff, currently on a dead website or Facebook-only. Plumbers, electricians, builders, cleaners, mechanics, landscapers, barbers, hair & beauty.

**Secondary — Christmas wedge (from mid-October):** Adelaide food & gift retail. Butchers, bakeries, cafés, restaurants, gift shops, halal grocers/butchers. These have a hard Christmas deadline and real money on the line, which makes them urgent buyers — but they are the ones who need ecommerce, so they are the harder build.

**Explicitly out of scope for 3 months:** anyone with >100 SKUs, anyone needing bookings/calendar sync, franchises, multi-location, anyone with an existing site they want migrated 1:1, professional services needing client portals.

### Persona A — "Dave", 44, Dave's Gas & Plumbing, Salisbury SA
Two vans, one apprentice. Gets work from word of mouth and a 2014 website his brother-in-law built on Joomla that he cannot log into. Googles his own business name and is embarrassed. Wants: phone number huge, "24/7 emergency", the suburbs he covers, a few job photos, and to never think about it again. Will pay A$39–59/mo without blinking if it takes him 20 minutes. Will not pay A$2,500.

**Christmas need:** holiday shutdown dates + emergency callout rates. Real, but small.

### Persona B — "Amina", 36, Adelaide Halal Meats, Mile End
Retail shopfront, 60% of annual profit lands Nov–Dec. Takes Christmas/Eid ham-equivalent (whole lamb, gift boxes) orders on a paper pad and WhatsApp, loses orders, has no way to take deposits. Wants: specials, gift boxes, pre-orders with a deposit, delivery suburbs, WhatsApp button.

**Christmas need:** enormous. She will pay A$99/mo and a A$899 setup fee in October if it captures pre-orders.

Persona B is where the money is. Persona A is where the *volume and the easy build* is. The product serves both from one spec; the GTM runs them as two tracks.

## 4. Positioning

Not a Wix competitor. Not a Shopify competitor. Position against **the agency quote and the empty Saturday afternoon**.

| | Wix/Squarespace | Local agency | **Awning** |
|---|---|---|---|
| Time to live | 10–20 hrs of your time | 4–8 weeks | 20 minutes |
| Cost | A$30/mo + your weekend | A$3,500 + A$120/mo | A$49/mo |
| To change something | You learn the editor | Email, wait, invoice | Type a sentence |
| Who wrote the words | You did, badly, at 11pm | Copywriter, +A$800 | Written for you |
| Hosted | US | Wherever | **Sydney** |
| Understands "we service the Adelaide Hills" | No | Yes | Yes |

**The differentiator that actually holds** is not the AI — Wix, Squarespace and GoDaddy all shipped AI builders in 2024–25 and they are fine. It is **AI + a human in Adelaide who answers the phone + Australian defaults out of the box** (ABN in the footer, GST-inclusive pricing, AU phone/address formats, state public holidays, .com.au, Sydney hosting, Afterpay). Compete on service and locality; the AI is what makes serving them at A$49/mo economically possible.

## 5. Product principles

1. **The owner never sees a website editor.** Chat and a preview. No drag-drop, no layers panel, no breakpoints, ever.
2. **The AI proposes, the schema disposes.** Model output that fails validation is retried, never rendered.
3. **A generated site is never blank and never lorem.** If we lack a fact, we ask one question or omit the section — we do not invent.
4. **Never invent a testimonial, review, rating, award, certification, licence number or years-in-business.** This is Australian Consumer Law, not a style preference (see §7).
5. **Publish is a status change, not a deploy.** Under 2 seconds, always.
6. **Mobile is the design target.** ~78% of local-service traffic is a phone, often outdoors, often on 4G.
7. **Every feature must survive the question: does this get us to 10 paying customers?** If not, it is Month 4.

## 6. MVP feature list

Legend — **P0** = required for first paying customer. **P1** = required for the Christmas campaign. **P2** = required for 50 customers. **P3** = post-launch, explicitly deferred.

### Account & onboarding
| Feature | Pri | Note |
|---|---|---|
| Email + password / email OTP sign-up | P0 | Better Auth, self-hosted |
| Google sign-in | P1 | |
| Organisation (1 org : n sites, 1 site in MVP) | P0 | Multi-site is a Month 5 upsell |
| 7-question onboarding wizard | P0 | § 15 of brief; hard cap at 8 |
| ABN lookup autofill | P2 | ABR public API, free — fills legal name + trading name + GST status. Very high delight, ~4 hrs work |
| Resume incomplete onboarding by email | P1 | Recovers ~20% of drop-off |

### Generation
| Feature | Pri | Note |
|---|---|---|
| Brief → WebsiteSpecification (Sonnet, structured output) | P0 | |
| 3 design directions shown side by side | P1 | Big perceived-value lever, low cost — reuse one content pass, vary theme + variants only |
| Template picker (industry-filtered) | P0 | Template = a pre-baked spec |
| "Design it for me" path | P0 | |
| Regenerate with feedback | P0 | |
| Stock image auto-selection by industry | P0 | Curated Pexels/Unsplash pool, **not** AI image generation |
| AI image generation | P3 | Metered add-on only. Cost and quality both bad for MVP |

### Editing
| Feature | Pri | Note |
|---|---|---|
| Chat editor with live preview | P0 | Left chat, right iframe |
| Tool-call patching (add/update/remove/reorder/theme) | P0 | See `04-AI-LAYER.md` |
| Undo last change | P0 | One button. Cheap because every patch is a version row |
| Full version history + restore | P2 | |
| Direct text editing (click text, type) | P1 | ~15% of edits are "fix this typo"; routing that through an LLM is slow, costly and annoying |
| Image upload / replace | P0 | |
| Logo upload | P0 | |
| Colour picker override | P1 | |
| Section show/hide toggle | P1 | |

### Site output
| Feature | Pri | Note |
|---|---|---|
| Multi-tenant renderer | P0 | |
| Wildcard subdomain `*.awningsites.com` | P0 | |
| Publish / unpublish | P0 | |
| Mobile responsive | P0 | Non-negotiable |
| SEO metadata, OG tags, sitemap.xml, robots.txt | P0 | |
| JSON-LD LocalBusiness schema | P1 | Genuine ranking benefit for local search; ~6 hrs |
| Favicon | P1 | |
| Custom domain — concierge (you run the API call) | P0 | For first ~15 customers |
| Custom domain — self-serve wizard | P2 | |
| Google Analytics / Meta Pixel via config field | P2 | **Never** a raw `<script>` paste box |
| Blog | P3 | |
| Multi-language | P3 | |

### Lead capture
| Feature | Pri | Note |
|---|---|---|
| Contact form → email + dashboard inbox | P0 | The single most valuable feature to a tradie |
| Spam protection (Cloudflare Turnstile + honeypot) | P0 | |
| Click-to-call / click-to-email | P0 | |
| WhatsApp CTA | P0 | Critical for halal/migrant-owned retail |
| Quote-request form with job-type field | P1 | |
| Newsletter signup + export | P1 | Spam Act: consent checkbox, sender ID, unsubscribe |
| Booking/calendar | P3 | Big. Month 5. |

### Christmas pack (P1 — must ship by 2 November, end of week 8)
Announcement bar · Christmas hero variants · `/christmas` landing page generator · gift-card product type · countdown to a **real** date · holiday trading-hours block (SA public holidays pre-loaded) · Christmas delivery-cutoff notice · gift-box collection · discount code · Christmas email capture · 6 seasonal templates.

### Ecommerce (P2 — Store plan)
Products (10–100 SKUs) · images · GST-inclusive pricing · inventory count · categories · cart · **Stripe Checkout via Connect Standard** · Afterpay + Apple/Google Pay · orders dashboard · order confirmation email · flat-rate + free-over-$X + local pickup + local delivery-radius shipping · discount codes · **pre-order / deposit product type** (Persona B's actual need).

Deferred: variants beyond one axis, multi-warehouse, POS, live carrier rates, tax automation, subscriptions, abandoned cart, marketplace.

### Platform
Stripe subscription billing + AU GST invoices · plan-based AI quotas + hard spend circuit breaker · admin console (impersonate, force-republish, quota override) · Sentry · uptime canaries · daily ops digest.

## 7. Australian compliance requirements (build-time, not later)

These are requirements, not nice-to-haves. Several are things a generic US-built AI site builder gets wrong, which is part of the local moat.

| Area | Requirement | Where it lands |
|---|---|---|
| **ACL — misleading conduct** | AI must never fabricate testimonials, reviews, star ratings, awards, "licensed", "insured", "certified", licence numbers, "family owned since 1987", or customer counts. The ACCC actively enforces fake reviews; penalties reach the greater of A$50M / 3× benefit / 30% of turnover. Testimonial components render only tenant-entered text with an attestation checkbox. | AI system prompt hard rules + `banned_claims` validator + testimonials require `source: "customer_supplied"` |
| **ACL — component pricing** | Displayed price must be a single total inclusive of GST and any unavoidable fee. | Products store `price_cents` GST-inclusive; renderer shows "incl. GST" |
| **ACL — countdowns & was/now** | A countdown must reference a real end date the tenant entered; no auto-reset. No strikethrough "was" price unless the tenant confirms it was actually sold at that price for a reasonable period. | Countdown requires `endsAt`; compare-at price requires attestation |
| **Spam Act 2003** | Consent, sender identification, functional unsubscribe on every marketing email. | Newsletter component ships with consent checkbox; export includes consent timestamp + IP |
| **Privacy Act 1988 / APPs** | The platform holds tenant end-customer data (form leads, orders) → platform is an APP entity regardless of the small-business exemption. Needs a privacy policy, a collection notice, breach-response plan, and a data-processing term in tenant T&Cs. Generate a tenant-facing privacy policy automatically. | `07-SECURITY-OPS.md` |
| **Data residency** | Sydney (`ap-southeast-2`) for app, DB and object storage. Market it. | `02-ARCHITECTURE.md` |
| **Tax invoices** | Awning's own invoices to tenants must show ABN, "Tax Invoice", and GST. Stripe Tax handles AU GST on subscriptions. | `06-COMMERCE-BILLING.md` |
| **.com.au** | Requires an ABN/ACN and (since 2022) direct registration. We connect domains; we do **not** resell them in MVP. | `02-ARCHITECTURE.md` |
| **Accessibility** | WCAG 2.1 AA as a component-library constraint — contrast, focus rings, alt text, semantic landmarks. Cheap if built in, brutal to retrofit, and it protects tenants from ACL/DDA complaints. | `05-COMPONENTS.md` |

## 8. Success criteria at 8 December 2026

### Product
| Metric | Target | How measured |
|---|---|---|
| Generation succeeds (valid spec, renders, no empty sections) | ≥ 95% | Eval harness of 60 canned briefs, run in CI |
| Sign-up → published site | < 10 min median | Product analytics funnel |
| AI edit applied correctly first try | ≥ 90% | Thumbs-down rate on edit turns |
| Published site mobile Lighthouse perf | ≥ 85 | Lighthouse CI on 5 canary sites |
| Published site LCP (mobile, 4G) | < 2.5 s | Real-user monitoring |
| Custom domain live incl. SSL | < 30 min from CNAME | Domain state machine timestamps |
| Renderer uptime | ≥ 99.9% | External canary, 1-min interval, 3 tenant hostnames |

### Business
| | Minimum | Good | Excellent |
|---|---|---|---|
| Paying customers | 10 | 25–50 | 100+ |
| Exit MRR | A$450 | A$1,100–2,200 | A$4,400+ |
| Setup-fee revenue (3 mo) | A$1,200 | A$3,600 | A$9,000 |
| Logo churn (Nov) | < 10% | < 5% | < 3% |

**The metric that actually matters** and that the brief does not list: **how many of the first 20 customers would be "very disappointed" if the product disappeared, and how many referred someone.** At n=50, a referral rate above ~0.3 per customer is worth more signal than the MRR number.

## 9. Explicit non-goals for 3 months

Bookings/calendar · blog & content marketing tools · AI SEO/social/ads/email · CRM & invoicing · reviews aggregation · loyalty · memberships · multi-language · white-label/reseller · a public template marketplace · a drag-and-drop editor · migrating existing sites · anything outside Australia · a mobile app · POS · complex shipping · tax automation.

Say no to all of these in sales calls without embarrassment. "Not yet — that's on the roadmap for autumn" is a complete answer.
