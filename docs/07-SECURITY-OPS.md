# Awning — Security Model, Monitoring & Testing

Covers brief deliverables 18, 21, 22.

---

## 1. Threat model

You are running arbitrary customer-authored content on domains you control, on behalf of businesses who will blame you for anything that goes wrong. The realistic threats, ranked:

| # | Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| T1 | Cross-tenant data leak (Site A sees Site B's leads/orders) | Medium | **Fatal** | org scoping + RLS + renderer role separation + a test that asserts it |
| T2 | Cookie/session attack via shared parent domain | Medium | **Fatal** | tenant sites on a separate registrable domain + PSL |
| T3 | Stored XSS via generated content or theme injection | Medium | High | closed schema, no raw HTML, CSS value re-validation, strict CSP |
| T4 | Hostname takeover (attacker claims a domain they don't own) | Medium | High | TXT ownership verification before activation; never activate on DNS-points-at-us alone |
| T5 | Runaway AI spend | **High** | High | quotas + per-org cap + platform circuit breaker |
| T6 | Form spam / mail-reputation damage | **High** | Medium | Turnstile, honeypot, rate limit, per-site send caps |
| T7 | Credential stuffing on owner accounts | Medium | High | rate limit, breach-password check, optional 2FA |
| T8 | Stripe webhook forgery / replay | Low | High | signature verification + idempotency table |
| T9 | Malicious upload (SVG with script, polyglot, zip bomb) | Medium | Medium | type sniffing, re-encode, serve from a separate origin |
| T10 | SSRF via an image URL the AI or user supplies | Low | High | no fetch-by-URL; uploads only + a fixed stock pool |
| T11 | Prompt injection via business description | Medium | **Low** | schema ceiling — worst case is silly copy |
| T12 | A tenant publishes illegal content on your domain | Medium | Medium | AUP, abuse@ address, takedown runbook, content scan on publish |

T11 being low-impact is a *result of the architecture*, not luck. That is the argument for the spec layer.

## 2. Tenant isolation

Four independent layers; any one failing is survivable.

1. **Application** — `orgProcedure` resolves the org from the session and asserts membership. No route handler receives an `orgId` from the client.
2. **Database** — RLS on every org-scoped table. The app role has no `BYPASSRLS`.
3. **Connection** — `withOrgContext(orgId, fn)` sets `app.org_id` transaction-locally. Direct `prisma.*` calls outside it are blocked by a lint rule and a CI grep.
4. **Process** — the renderer runs as a separate Fly app with a distinct read-mostly DB role. It has no session-handling code, no admin routes, and no write access to `organizations`, `subscriptions` or `users`. A full compromise of the renderer cannot read a password hash or change a plan.

**The test that must exist before the first customer:** create two orgs with full data, authenticate as A, and attempt every read and mutation against B's ids across every tRPC procedure. Assert `NOT_FOUND` or `FORBIDDEN` on all of them. Generate it from the router definition so a new procedure without a test fails CI. This is the single highest-value test in the codebase.

## 3. Content security on published sites

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random}' https://challenges.cloudflare.com;
  style-src 'self' 'nonce-{random}';
  img-src 'self' https://cdn.awning.au data:;
  font-src 'self';
  frame-src https://challenges.cloudflare.com https://js.stripe.com;
  connect-src 'self';
  form-action 'self' https://checkout.stripe.com;
  frame-ancestors 'self' https://app.awning.au;    ← preview iframe only
  base-uri 'none'; object-src 'none'; upgrade-insecure-requests;
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

No `unsafe-inline` — the theme `<style>` block carries the nonce. This is exactly why the theme is custom properties rather than arbitrary inline styles scattered through the tree.

**No raw HTML embed field in the MVP.** When customers ask for Google Analytics or a Meta Pixel (they will, around customer 20), add *typed config fields* — `ga4MeasurementId`, `metaPixelId` — validated by regex and rendered into a vetted snippet. A `<script>` paste box is a stored-XSS feature with a friendly label, and it permanently destroys the CSP.

## 4. Upload handling

Sniff the magic bytes, never trust `Content-Type` or the extension. Allow `jpeg/png/webp/avif/gif` only. **Re-encode every image through sharp** — this strips EXIF (including GPS coordinates from a phone photo of someone's home, an actual privacy incident waiting to happen) and neutralises polyglots. Reject SVG entirely for user uploads. Cap at 10 MB and 8000 px. Randomise the R2 key. Serve from `cdn.awning.au` with `Content-Disposition: inline` and `nosniff`.

## 5. Australian privacy obligations

The platform processes personal information (leads, order data, shopper details) on behalf of tenants, at scale — so the Privacy Act applies to Awning regardless of the small-business exemption that may cover individual tenants.

**Required before the first paying customer:**
- Awning privacy policy + collection notice.
- Tenant T&Cs with a data-processing clause: the tenant is the controller of their site's data, Awning is the processor, purposes are limited, sub-processors are listed (Anthropic, Stripe, Cloudflare, Resend, Neon, Fly).
- An **auto-generated privacy policy for each tenant site**, populated from what the site actually collects. Genuinely useful, ~4 hours to build, and most competitors don't do it.
- Notifiable Data Breaches runbook: assess within 30 days, notify the OAIC and affected individuals if serious harm is likely. Write it now, not during the incident.
- Data minimisation: hash IPs in `form_submissions`, don't log request bodies containing personal information, redact in Sentry.
- Deletion: 30-day soft delete, then hard purge, with an export-first flow.
- **Sub-processor disclosure includes Anthropic.** Tenant business descriptions go to a model API. That belongs in the privacy policy — say it plainly rather than hoping nobody asks.

## 6. Secrets & access

Fly secrets (or Doppler) — never `.env` in git. Rotate the Anthropic, Stripe and Cloudflare keys quarterly and on any laptop compromise. Separate Stripe restricted keys per surface. The Cloudflare token is scoped to the two zones and to Custom Hostnames + Cache Purge only, never account-wide. 2FA mandatory on Cloudflare, Stripe, GitHub, Fly, Neon. `gitleaks` in pre-commit and CI.

> Relevant precedent: the dev.vezmo.com incidents in August and September 2026 both turned into full host-credential exfiltration because secrets sat in reachable `.env` files on a box with an unpatched public service. Same failure mode applies here — keep secrets out of the filesystem, and keep the renderer's blast radius small.

## 7. Monitoring & logging

| Layer | Tool | Alerts on |
|---|---|---|
| Errors | Sentry (both apps + worker) | new issue, error-rate spike, any renderer 500 |
| Logs | Axiom (structured JSON, `request_id`, `site_id`, `org_id`) | 14-day hot |
| Uptime | BetterStack, 1-min, 3 real tenant hostnames + `app` + `/health` | 2 consecutive failures → phone |
| Performance | Lighthouse CI in the pipeline + Cloudflare RUM | LCP p75 > 2.5 s |
| Business | PostHog | signup → generate → publish → pay funnel |
| **AI spend** | custom dashboard from `ai_usage` | daily spend > A$40, any org > A$6/mo |
| DB | Neon metrics | connections > 80%, p95 query > 200 ms |
| Domains | worker job | any domain stuck > 24 h |
| Queue | BullMQ board | depth > 100, any DLQ entry |

### The single alert that matters most
`renderer 5xx rate > 0.5% for 2 minutes → phone call`. When the renderer is down, **every customer's website is down simultaneously** — that is the multi-tenant tradeoff and the thing that ends the business if it happens twice in December. Everything else can wait for morning.

### Daily ops digest (email, 7am)
New signups · sites published · AI spend vs budget · errors by count · domains stuck · failed payments · form submissions delivered · slowest 5 endpoints. Five minutes over coffee replaces a dashboard you'd never open.

### Structured logging
Every log line carries `request_id`, and `site_id`/`org_id` where known. **Never log:** form payloads, email bodies, tokens, full AI prompts containing business data (log a hash + token counts instead).

## 8. Testing strategy

The pyramid, weighted for what actually breaks in this system:

```
              ▲  Manual: generate 10 sites weekly and LOOK at them
             ╱ ╲   (automation cannot tell you a site is ugly)
            ╱   ╲
           ╱ E2E ╲     Playwright ×8 flows
          ╱───────╲
         ╱  AI     ╲    60-brief eval harness ← the highest-value suite
        ╱   evals   ╲
       ╱─────────────╲
      ╱  Integration  ╲  tRPC + testcontainers PG, webhooks, isolation matrix
     ╱─────────────────╲
    ╱      Unit         ╲ spec validation, migrations, pricing/GST, patch apply
   ╱─────────────────────╲
```

**Unit** — spec validators (the property test: *no input produces a spec that validates but fails to render*), spec migrations across every version pair, GST and discount arithmetic, tool-call patch application, hostname normalisation, subdomain slug rules.

**Integration** (real Postgres via testcontainers) — the cross-tenant isolation matrix (§2), RLS enforcement, Stripe webhook idempotency (fire the same event 3×, assert one order), domain state machine transitions, quota enforcement.

**AI evals** — 60 briefs, run on every prompt/schema change. Gates: 100% schema validity, 0 banned claims, 0 placeholder strings, WCAG AA palettes, cost within budget. Snapshot the specs and diff them, so a prompt tweak that quietly changes every generated site shows up in review.

**Visual regression** — Storybook + Playwright screenshots, every component × every variant, light and dark, mobile and desktop. ~250 snapshots. This is what lets you refactor the component library in November without hand-checking 50 live sites.

**E2E (Playwright, 8 flows)** — signup→generate→publish · AI edit applies and persists · custom domain wizard (Cloudflare mocked) · contact form → email delivered · add product → checkout → order (Stripe test mode) · subscription checkout → publish unlocked · undo/restore · suspended-site 402.

**Load** — k6 against the renderer: 500 rps on cached pages, 50 rps uncached, 20 concurrent form posts. Run once in Month 3 before the Christmas traffic. You are looking for the origin's uncached ceiling, because that is what a cache purge at 6pm on 20 December will expose.

### CI gates (merge blocked)
typecheck · eslint · unit · integration · **isolation matrix** · **AI evals** · axe (0 violations) · visual regression · Lighthouse budget · `prisma migrate diff` clean · gitleaks.

## 9. Incident runbooks (write before you need them)

1. **Renderer down** → check Fly health, roll back last release, verify Cloudflare "Always Online" is serving stale, post to status page.
2. **Bad deploy corrupting specs** → stop the worker, roll back, restore affected sites from `site_versions` (this is why versions are immutable).
3. **AI spend spike** → circuit breaker auto-trips; identify the org from `ai_usage`, pause, contact.
4. **Cross-tenant leak suspected** → disable the affected surface, preserve logs, assess NDB within 30 days, notify OAIC if serious harm likely.
5. **Cloudflare zone/SSL outage** → all tenant domains affected simultaneously; comms first, no code fix available. Have the email drafted in advance.
6. **Tenant publishes illegal content** → suspend the site, notify, retain evidence, respond to abuse@ within 24 h.
7. **Stripe Connect account restricted** → tenant's checkout fails; detect via `account.updated`, notify the tenant, disable the cart with a clear message rather than a broken button.
