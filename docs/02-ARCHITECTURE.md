# Awning — System, Multi-Tenant, Domain & Deployment Architecture

Covers brief deliverables 4, 7, 12, 13, 14, 15, 20.

---

## 1. Domain layout (get this right on day one — it is unfixable later)

```
awning.au                  marketing site            (Next.js, static-ish)
app.awning.au              dashboard + API + AI      (Next.js, authenticated)
awningsites.com            TENANT SITES              (Next.js renderer)
  *.awningsites.com        subdomains: daves-plumbing.awningsites.com
cname.awningsites.com      CNAME target for custom domains
cdn.awning.au              R2 public bucket via Cloudflare
```

### Why tenant sites live on a *separate registrable domain*

This is the single most important security decision in the whole system, and the brief's `customer1.platform.com` layout gets it wrong.

If tenant sites are on `*.platform.com` and the dashboard is on `app.platform.com`, then any tenant page can call `document.cookie = "x=y; domain=.platform.com"` — a **session-fixation and cookie-jar attack across every tenant and the dashboard itself**. Same-site cookie protections do not help; these are the same site. Any XSS or user-supplied embed on one tenant site becomes an attack on the platform.

Putting tenant content on `awningsites.com` makes app and tenant content cross-site at the browser level: separate cookie jars, separate storage, separate origin for CSP purposes. Also submit `awningsites.com` to the **Public Suffix List** so that browsers treat each tenant subdomain as its own site and refuse `domain=.awningsites.com` cookies. (PSL submission takes weeks — file it in week 2, it costs nothing.)

## 2. System architecture

```
                        ┌────────────────────────────────────────┐
                        │            CLOUDFLARE (Sydney)         │
                        │  DNS · WAF · CDN cache · SSL for SaaS  │
                        │  Turnstile · Images · R2               │
                        └───────┬───────────────────┬────────────┘
                                │                   │
        app.awning.au ──────────┤                   ├────── *.awningsites.com
                                │                   │       + custom hostnames
                                ▼                   ▼
                  ┌──────────────────────┐  ┌──────────────────────┐
                  │   APP (Next.js)      │  │  RENDERER (Next.js)  │
                  │   Fly.io syd         │  │  Fly.io syd          │
                  │  ─────────────────   │  │  ─────────────────   │
                  │  Dashboard UI        │  │  Host→site resolver  │
                  │  Onboarding          │  │  Spec loader (cache) │
                  │  Chat editor         │  │  Component renderer  │
                  │  REST/tRPC API       │  │  Forms endpoint      │
                  │  Auth (Better Auth)  │  │  Cart + checkout     │
                  │  Stripe webhooks     │  │  sitemap/robots/OG   │
                  └───────┬──────────────┘  └──────┬───────────────┘
                          │                        │
                          ├────────┬───────────────┤
                          ▼        ▼               ▼
                  ┌───────────┐ ┌──────────┐ ┌──────────────┐
                  │ Postgres  │ │  Redis   │ │  R2 (Sydney) │
                  │ Neon syd  │ │ Upstash  │ │ images/logos │
                  └───────────┘ └──────────┘ └──────────────┘
                          │
                          ▼
                  ┌────────────────────────────────────────┐
                  │ WORKER (same image, queue consumer)    │
                  │ AI generation · domain state machine   │
                  │ cache purge · emails · thumbnails      │
                  └───────┬────────────────┬───────────────┘
                          ▼                ▼
                  ┌──────────────┐  ┌──────────────┐
                  │ Anthropic    │  │ Stripe /     │
                  │ Claude API   │  │ Resend / CF  │
                  └──────────────┘  └──────────────┘
```

**Two Next.js apps, one repo, one Docker image, one Postgres.** They are separate Fly apps because their scaling, caching and blast radius differ completely: the renderer must never go down when you deploy a dashboard change, and the renderer must never hold an admin session cookie.

## 3. Technology choices (and the ones I'd change from the brief)

| Layer | Choice | Reasoning |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript, Tailwind** | As briefed. Server Components make the renderer genuinely fast. |
| API style | **tRPC for dashboard, REST for webhooks/public** | tRPC removes an entire class of typing work for a solo dev. Public endpoints (forms, cart) stay REST so they are cacheable and callable from anywhere. |
| ORM | **Prisma** | As briefed. Note: Prisma + RLS needs a per-request `SET LOCAL app.org_id` on a raw connection; documented in `07-SECURITY-OPS.md`. |
| DB | **Neon Postgres, ap-southeast-2** | Branching gives you a throwaway DB per PR. Alternative: Supabase Sydney. Avoid RDS for MVP — cost and ops. |
| Cache/queue | **Upstash Redis (Sydney) + BullMQ** | Do not add SQS/Rabbit. |
| Auth | **Better Auth** | TS-native, first-class organisations/multi-tenancy, self-hosted so no per-MAU fee and no US data residency problem. Clerk is faster to wire but is US-hosted and gets expensive. Do not roll your own. |
| Storage | **Cloudflare R2 (APAC)** | Zero egress fees — this is what keeps image bandwidth off the P&L. |
| Image transforms | **Cloudflare Images** or R2 + Image Resizing | Never serve an owner's 6 MB phone photo raw. |
| Edge/DNS/SSL | **Cloudflare** — Pro plan + Cloudflare for SaaS | Custom hostnames + SSL automation is the whole reason. |
| Hosting | **Fly.io, `syd` region** | Sydney region, scale-to-zero for the worker, ~A$60/mo at MVP, zero-downtime deploys, Docker-native. **Not Vercel** for the renderer: tenant bandwidth on Vercel's pricing is a business-model risk once sites get traffic. Documented exit: same Docker image → DigitalOcean SYD1 droplet + Traefik. |
| Payments | **Stripe** — Billing for subscriptions, Connect Standard for tenant commerce | |
| Email | **Resend** (transactional + tenant form notifications) | Separate sending domain for tenant-triggered mail so tenant spam complaints cannot poison your billing-email reputation. |
| AI | **Anthropic Claude** — Sonnet for generation, Haiku for edits | |
| Errors/logs | **Sentry** + **Axiom** | |
| Analytics | **PostHog** (product) + **Cloudflare Web Analytics** (tenant-facing, cookieless — no consent banner needed, which is itself a feature) | |

## 4. Multi-tenant request flow (renderer)

```
GET https://daves-plumbing.awningsites.com/services
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Cloudflare edge                                         │
│  • cache key = host + path + device-class               │
│  • HIT  → return in ~15 ms, origin never touched        │
│  • MISS → forward to origin, add Cache-Tag: site-{id}   │
└────────────────────┬────────────────────────────────────┘
                     ▼ (miss only)
┌─────────────────────────────────────────────────────────┐
│ Next.js middleware                                      │
│  host = req.headers.host  (lowercase, strip port)       │
│  ┌───────────────────────────────────────────────────┐  │
│  │ resolveTenant(host)                               │  │
│  │  1. Redis GET tenant:{host}          ~1 ms        │  │
│  │  2. miss → Postgres site_domains     ~8 ms        │  │
│  │           WHERE hostname=$1 AND status='active'   │  │
│  │  3. miss → 404 "site not found" page              │  │
│  │  4. cache 300 s (and purge on domain change)      │  │
│  └───────────────────────────────────────────────────┘  │
│  rewrite → /_sites/{siteId}/services                    │
│  set x-awning-site header                               │
└────────────────────┬────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│ app/_sites/[siteId]/[[...slug]]/page.tsx  (RSC)         │
│  spec = getPublishedSpec(siteId)   ← Redis, then PG     │
│  page = spec.pages.find(matches slug) ?? 404            │
│  <SpecRenderer spec={spec} page={page} />               │
│  → HTML, Cache-Control: public, s-maxage=31536000,      │
│    stale-while-revalidate=86400                         │
│    Cache-Tag: site-{id}, page-{id}                      │
└─────────────────────────────────────────────────────────┘
```

Two consequences worth stating plainly:

1. **Steady-state cost per tenant site is ~zero.** A published site with cached HTML never reaches Fly. 500 tenant sites do not need 500 containers, or even 2 large ones — origin traffic is only cache misses and form posts.
2. **Publishing is `UPDATE sites SET published_version_id = $1` + a Cloudflare purge-by-tag call.** Sub-2-second, no build step, no deploy. This is the correct reading of the brief's §12.

### Hostname resolution edge cases you will hit
- `www.` vs apex on custom domains → store both rows, 301 the non-canonical one.
- Uppercase / trailing-dot hosts (`Foo.Com.`) → normalise before lookup.
- Cloudflare health checks and `*.fly.dev` internal hosts → allowlist, never treat as tenant.
- Unknown host → branded 404 with a "claim this domain" CTA, **not** a Next.js error page (this is a marketing surface).
- Site `status='suspended'` (non-payment) → 402 page with the owner's contact, still SEO-noindex.

## 5. Subdomain architecture

One wildcard DNS record, created once, never touched again:

```
Type: CNAME   Name: *   Target: renderer.fly.dev   Proxied: yes
Type: CNAME   Name: @   Target: renderer.fly.dev   Proxied: yes
```

Cloudflare's Universal SSL covers `*.awningsites.com` (one level deep — which is all we need).

**Subdomain allocation rules:**
- Slugify the business name; on collision append `-2`, `-3`.
- Reserve a blocklist: `www admin api app mail smtp ftp cdn assets static test staging dev preview blog help support docs status shop store account billing login signup auth cname` + profanity + the platform name.
- Minimum 3 chars, `[a-z0-9-]`, no leading/trailing hyphen, no `xn--` (homograph abuse).
- Allow one free rename; after that it's a support action (subdomain changes break inbound links and Google).
- Subdomain sites are `noindex` **only** if the owner also has a custom domain attached — otherwise let them index; for many tradies the subdomain *is* the site.

## 6. Custom domain architecture

Uses **Cloudflare for SaaS (Custom Hostnames)**. The tenant points DNS at us; Cloudflare issues and renews the certificate; we never touch ACME.

### The flow the customer sees

```
1. Owner types:  daveplumbing.com.au
2. We show, copy-pasteable, with a screenshot for GoDaddy/Crazy Domains/VentraIP:

   Type: CNAME   Name: www   Value: cname.awningsites.com
   Type: CNAME   Name: @     Value: cname.awningsites.com     (CNAME flattening)
       — or if their registrar rejects apex CNAME —
   Type: A       Name: @     Value: <CF anycast IP>

   Verification (only needed before DNS is pointed):
   Type: TXT     Name: _cf-custom-hostname.www   Value: <token>

3. We poll. States advance automatically. Owner gets an email at `active`.
```

### State machine

```
     ┌─────────┐  owner submits
     │ pending │◄──────────────
     └────┬────┘
          │ create CF custom_hostname
          ▼
   ┌─────────────┐   DNS not found / wrong target
   │  verifying  │────────────────────────┐
   └──────┬──────┘   (retry 30s→5m backoff│, 72h TTL)
          │ ownership OK                  ▼
          ▼                          ┌────────┐
   ┌──────────────┐  cert issue fail │ failed │
   │ ssl_pending  │─────────────────►└────┬───┘
   └──────┬───────┘                       │ owner fixes DNS
          │ cert active                   │ → back to verifying
          ▼                               │
     ┌────────┐                           │
     │ active │◄──────────────────────────┘
     └───┬────┘
         │ owner removes / non-payment / cert renewal fail
         ▼
   ┌──────────┐
   │ detached │
   └──────────┘
```

Persisted per row: `hostname, site_id, is_primary, cf_hostname_id, status, verification_txt, last_checked_at, error_code, error_message_human, activated_at`.

**`error_message_human` matters more than it looks.** "CNAME record found but points to `parking.godaddy.com` — you need to delete GoDaddy's parking record first" prevents a 20-minute support call. Write a lookup table of the eight failure modes:

| Detected | Human message |
|---|---|
| No CNAME/A at all | Record hasn't appeared yet — DNS can take up to 24h. We'll keep checking. |
| Points at parking page | Your registrar's parking record is still there; delete it, then re-add ours. |
| Points at old host | Found a record pointing to `<x>` — that's your old website host. Replace it with ours. |
| Cloudflare-proxied at their end | Your domain is on Cloudflare — set the record to **DNS only** (grey cloud), not proxied. |
| CAA record blocks issuance | Your domain has a CAA record only allowing `<x>`; add `0 issue "letsencrypt.org"`. |
| Apex CNAME rejected by registrar | Use the A record instead: `<IP>`. |
| MX on apex + CNAME conflict | Your email would break — point `www` only and we'll redirect the bare domain. |
| Domain expired | Domain lapsed on `<date>` — renew with your registrar first. |

**Cost:** Cloudflare for SaaS is US$0.10/custom hostname/mo beyond the free 100 on a paid plan. At 50 customers this is free.

**Never register or resell domains in the MVP.** `.com.au` carries auDA eligibility (ABN/ACN, close-and-substantial connection), renewal liability and a support burden that will eat your week. Connect only. Recommend a registrar and move on.

## 7. Cloudflare integration plan

| Capability | Use | Notes |
|---|---|---|
| DNS | wildcard + apex for `awningsites.com` | one-time |
| SSL for SaaS / Custom Hostnames | tenant custom domains | API: `POST /zones/{z}/custom_hostnames` |
| Cache + Cache-Tag purge | published-site HTML | `POST /zones/{z}/purge_cache {tags:["site-123"]}` — Enterprise-only for tag purge ⚠️ |
| **Cache purge fallback** | purge-by-URL (up to 30 URLs/call) or a versioned cache key | See below |
| R2 | images, logos, product photos | zero egress |
| Images | resize/format/quality | or `/cdn-cgi/image/` on R2 |
| Turnstile | contact & newsletter forms | free, no consent banner |
| WAF + rate limiting | brute force, form abuse, scrapers | free tier is enough |
| Web Analytics | tenant-facing stats | cookieless |
| Bot Fight Mode | off for tenant sites — it blocks legitimate crawlers | |

⚠️ **Cache-Tag purge is Cloudflare Enterprise.** Do not architect around it on a Pro plan. Two workable alternatives, pick the second:

1. Purge-by-URL on publish (you know the tenant's page list — usually <10 URLs). Works, but misses query-string variants.
2. **Versioned cache key.** Rewrite to an internal path carrying the published version, so publishing makes every old cached object unreachable rather than purging it.

> ⚠️ **Correction, found while building R-01.** Option 2 as originally written does not work on Next.js middleware. The rewrite would have to happen at the edge, but the epoch lives in Postgres and **Prisma cannot run on the edge runtime** — the middleware has no way to learn the version without a database round trip it cannot make. Tenant resolution therefore happens in the Node RSC, after the cache decision has already been taken.
>
> **What to actually do for the MVP:** `Cache-Control: public, s-maxage=60, stale-while-revalidate=86400` on tenant HTML, plus **purge-by-URL on publish** (a tenant's page list is under ten URLs, and purge-by-URL is on every paid plan). Worst case a publish takes 60 seconds to propagate; the explicit purge normally makes it instant. Simple, correct, and it costs nothing.
>
> **The upgrade path** when traffic justifies it: a Cloudflare Worker in front of the renderer that reads `host → epoch` from Workers KV and adds the epoch to the cache key, with KV written on publish. That gives the original design's properties — no purge call, no race — but it is real infrastructure and it is not a week-2 problem. `sites.cache_epoch` already exists and is already bumped on publish, so nothing needs to change in the schema when you get there.

## 8. Deployment architecture

```
GitHub push → main
   │
   ├─ CI: typecheck · eslint · vitest · prisma migrate diff ·
   │      AI eval harness (60 briefs) · Playwright smoke · Lighthouse budget
   │
   ├─ build ONE Docker image (multi-stage, distroless-ish node:22-slim)
   │
   ├─ prisma migrate deploy   (expand-only; see below)
   │
   ├─ fly deploy -a awning-renderer   (rolling, 2 machines, health-gated)
   ├─ fly deploy -a awning-app        (rolling, 2 machines)
   └─ fly deploy -a awning-worker     (1 machine, scale-to-zero)
```

**Migration discipline:** expand → deploy → contract, never a destructive migration in the same release as the code that stops using the column. With one dev and 50 live customer websites, a bad migration at 9pm is the outage that ends the trial.

**Environments:** `local` (Docker Compose: PG + Redis + Mailpit) → `preview` (Neon branch per PR, ephemeral Fly app) → `prod`. No separate staging; a Neon branch is better and free.

**Rollback:** `fly releases rollback` for code; site content rollback is a `site_versions` restore, which is a user-facing feature anyway.

### Infrastructure cost model (AUD/month)

| Item | Month 1 (0 cust) | Month 2 (10) | Month 3 (50) |
|---|---|---|---|
| Fly.io (app 2× + renderer 2× + worker) | 55 | 70 | 110 |
| Neon Postgres Sydney | 30 | 30 | 45 |
| Upstash Redis | 0 | 8 | 15 |
| Cloudflare Pro + SaaS hostnames | 40 | 40 | 45 |
| R2 + Images | 2 | 6 | 18 |
| Resend | 0 | 30 | 30 |
| Sentry + Axiom + PostHog | 0 | 25 | 45 |
| Anthropic API | 25 | 70 | 240 |
| Domains (awning.au, awningsites.com) | 8 | 8 | 8 |
| **Total** | **~A$160** | **~A$287** | **~A$556** |

Month 3 lands just over the A$500 ceiling, driven by AI. It is covered ~3.5× by revenue at that point, and §`04-AI-LAYER.md` has the levers (prompt caching, Haiku routing, quotas) that pull it back under A$400 if you need to.
